from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.csrf import verify_csrf
from app.core.file_cleanup import file_id_from_url
from app.core.security import (
    oauth2_scheme, decode_token, is_admin,
    encrypt_sensitive, decrypt_sensitive, mask_document_number,
    file_url_with_token,
)
from app.models import (
    User, UserRole, Notification, StoredFile,
    VerificationRequest, VerificationStatus
)
from app.schemas import (
    VerificationSubmitRequest, VerificationReviewRequest,
    VerificationRequestOut, VerificationStatusOut
)

router = APIRouter(prefix="/verification", tags=["Verification"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


def _request_out(r: VerificationRequest, *, reveal_number: bool) -> dict:
    """Сериализует заявку, расшифровывая номер документа.

    reveal_number=True отдаёт номер целиком — это нужно только модератору,
    который сверяет его со сканом. Владельцу заявки номер показываем
    замаскированным: подтвердить, что данные приняты, хватает и маски,
    а полный номер лишний раз не светится в интерфейсе и скриншотах.
    """
    number = decrypt_sensitive(r.document_number)
    return {
        "id": r.id,
        "user_id": r.user_id,
        "full_name": r.full_name,
        "document_type": r.document_type,
        "document_number": number if reveal_number else mask_document_number(number),
        # Скан отдаём подписанной ссылкой: файл помечен приватным (см.
        # submit_verification), поэтому без подписи ни владелец, ни модератор
        # его не откроют — получат 403. Подпись нужна обоим, а выдаём мы её
        # только тем, кто уже прошёл проверку прав выше.
        "file_url": file_url_with_token(r.file_url),
        "status": r.status.value if hasattr(r.status, "value") else str(r.status),
        "rejection_reason": r.rejection_reason,
        # Даты приводим к строке здесь, а не полагаемся на сериализатор:
        # схема объявляет их как str, и без .isoformat() FastAPI падал на
        # валидации ответа — то есть эндпоинт отдавал 500 целиком.
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }

@router.post("/submit", response_model=VerificationRequestOut)
def submit_verification(
    req: VerificationSubmitRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    # Верификация удостоверяет специалиста — заказчику она не нужна,
    # а принимать и хранить его документы мы не должны.
    if user.role != UserRole.specialist:
        raise HTTPException(403, "Верификация доступна только специалистам")

    # Проверяем, есть ли уже открытая заявка
    existing = db.query(VerificationRequest).filter(
        VerificationRequest.user_id == user_id,
        VerificationRequest.status == VerificationStatus.pending
    ).first()
    if existing:
        raise HTTPException(400, "Заявка на верификацию уже отправлена и ожидает проверки модератором")

    # Скан документа: проверяем, что это действительно файл заявителя, и
    # закрываем его от посторонних.
    #
    # Раньше значение из запроса клалось в БД как есть. Из-за этого в заявке
    # можно было сослаться на чужой файл (модератор сверял бы номер с чужим
    # сканом), а сам скан, загруженный как публичный, оставался перечислимым
    # по `/files/<id>` — то есть фото паспорта лежало в открытом доступе.
    if req.file_url:
        file_id = file_id_from_url(req.file_url)
        stored = (
            db.query(StoredFile).filter(StoredFile.id == file_id).first()
            if file_id is not None else None
        )
        if not stored:
            raise HTTPException(400, "Файл не найден — загрузите скан заново")
        if stored.owner_id != user_id:
            raise HTTPException(403, "К заявке можно приложить только свой файл")
        # Документ не должен оставаться публичным: у загрузки по умолчанию
        # scope=public (это верно для аватара), а здесь содержимое личное.
        stored.is_private = True

    new_req = VerificationRequest(
        user_id=user_id,
        full_name=req.full_name,
        document_type=req.document_type,
        # Номер документа в БД не хранится открытым текстом — только Fernet-токен
        document_number=encrypt_sensitive(req.document_number),
        file_url=req.file_url,
        status=VerificationStatus.pending
    )
    db.add(new_req)
    
    # Оповещение пользователю
    db.add(Notification(
        user_id=user_id,
        type="verification",
        title="Заявка на верификацию принята",
        text="Ваши документы переданы на модерацию. Проверка обычно занимает от 15 минут до 2 часов."
    ))
    
    db.commit()
    db.refresh(new_req)
    return _request_out(new_req, reveal_number=False)

@router.get("/status", response_model=VerificationStatusOut)
def get_verification_status(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
        
    latest_req = db.query(VerificationRequest).filter(
        VerificationRequest.user_id == user_id
    ).order_by(VerificationRequest.id.desc()).first()
    
    return {
        "verified": bool(user.verified),
        "request": _request_out(latest_req, reveal_number=False) if latest_req else None
    }

@router.get("/admin/list")
def list_verifications_admin(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(user):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")
    
    requests = db.query(VerificationRequest).order_by(VerificationRequest.id.desc()).all()
    results = []
    for r in requests:
        u = db.query(User).filter(User.id == r.user_id).first()
        item = _request_out(r, reveal_number=True)  # модератору нужен номер для сверки со сканом
        item["user_name"] = u.name if u else "—"
        item["user_email"] = u.email if u else "—"
        results.append(item)
    return results

@router.post("/admin/{request_id}/review")
def review_verification_admin(
    request_id: int,
    req: VerificationReviewRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    payload = decode_token_or_401(token)
    admin_user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin_user):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")
        
    v_req = db.query(VerificationRequest).filter(VerificationRequest.id == request_id).first()
    if not v_req:
        raise HTTPException(404, "Заявка не найдена")
        
    user = db.query(User).filter(User.id == v_req.user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
        
    v_req.resolved_at = datetime.utcnow()
    
    if req.action == "approve":
        v_req.status = VerificationStatus.approved
        user.verified = True
        db.add(Notification(
            user_id=user.id,
            type="verification",
            title="Профиль успешно верифицирован! 🎉",
            text="Поздравляем! Ваш статус проверенного специалиста подтверждён. В карточке появился зелёный бейдж доверия, а рейтинг в поиске увеличен."
        ))
    elif req.action == "reject":
        v_req.status = VerificationStatus.rejected
        v_req.rejection_reason = req.reason or "Документы не соответствуют требованиям"
        db.add(Notification(
            user_id=user.id,
            type="verification",
            title="Верификация отклонена",
            text=f"Причина: {v_req.rejection_reason}. Вы можете исправить данные и подать заявку снова."
        ))
    else:
        raise HTTPException(400, "Неверное действие: approve или reject")
        
    db.commit()
    return {"message": "Статус заявки обновлён", "status": v_req.status.value}
