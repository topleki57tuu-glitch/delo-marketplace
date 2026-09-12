"""Вывод заработанных средств.

Специалист выполняет заказ, платформа начисляет ему выплату за вычетом
комиссии — но забрать эти деньги было некуда: эндпоинта вывода не существовало
вообще, баланс оставался внутри сервиса. Здесь закрывается последний шаг
денежного цикла.

Модель работы — как у эскроу: сумма списывается с баланса в момент подачи
заявки, а не в момент решения модератора. Иначе пользователь мог бы подать
заявку на 50 000, потратить баланс на пакеты откликов и уйти в минус к тому
моменту, когда модератор нажмёт «выплачено».
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    oauth2_scheme, decode_token, is_admin,
    encrypt_sensitive, decrypt_sensitive, mask_requisites,
)
from app.models import (
    User, Notification, Transaction, TransactionType,
    WithdrawalRequest, WithdrawalStatus,
)
from app.schemas import (
    WithdrawalCreateRequest, WithdrawalReviewRequest, MIN_WITHDRAWAL,
)

router = APIRouter(tags=["Withdrawals"])


def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


def _serialize(w: WithdrawalRequest, *, reveal_requisites: bool) -> dict:
    """Сериализует заявку, расшифровывая реквизиты.

    Полные реквизиты нужны только модератору, который делает выплату.
    Владельцу показываем маску: подтвердить, куда уйдут деньги, хватает
    последних четырёх символов, а полный номер карты лишний раз не светится.
    """
    requisites = decrypt_sensitive(w.requisites)
    return {
        "id": w.id,
        "user_id": w.user_id,
        "amount": w.amount,
        "method": w.method,
        "requisites": requisites if reveal_requisites else mask_requisites(requisites),
        "status": w.status.value if hasattr(w.status, "value") else str(w.status),
        "comment": w.comment,
        "created_at": w.created_at,
        "resolved_at": w.resolved_at,
    }


def _notify(db: Session, user_id: int, title: str, text: str) -> None:
    db.add(Notification(user_id=user_id, type="withdrawal", title=title, text=text))


# ---------------------------------------------------------------- пользователь

@router.post("/wallet/withdraw")
def create_withdrawal(
    req: WithdrawalCreateRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    if req.amount < MIN_WITHDRAWAL:
        raise HTTPException(400, f"Минимальная сумма вывода — {MIN_WITHDRAWAL} ₽")

    balance = user.balance or 0
    if req.amount > balance:
        raise HTTPException(400, f"Недостаточно средств: доступно {balance} ₽")

    # Замораживаем сумму сразу, чтобы её нельзя было потратить до решения модератора
    user.balance = balance - req.amount
    db.add(Transaction(
        user_id=user.id,
        amount=-req.amount,
        type=TransactionType.withdraw_hold,
    ))

    request = WithdrawalRequest(
        user_id=user.id,
        amount=req.amount,
        method=req.method,
        requisites=encrypt_sensitive(req.requisites),
        status=WithdrawalStatus.pending,
    )
    db.add(request)
    db.commit()
    db.refresh(request)

    _notify(
        db, user.id, "Заявка на вывод создана",
        f"Заявка на вывод {req.amount} ₽ принята и ожидает обработки. "
        f"Сумма зарезервирована на балансе.",
    )
    db.commit()

    return _serialize(request, reveal_requisites=False)


@router.get("/wallet/withdrawals")
def list_my_withdrawals(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    items = (
        db.query(WithdrawalRequest)
        .filter(WithdrawalRequest.user_id == user_id)
        .order_by(WithdrawalRequest.id.desc())
        .all()
    )
    return [_serialize(w, reveal_requisites=False) for w in items]


@router.post("/wallet/withdrawals/{withdrawal_id}/cancel")
def cancel_withdrawal(
    withdrawal_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    request = db.query(WithdrawalRequest).filter(WithdrawalRequest.id == withdrawal_id).first()
    if not request:
        raise HTTPException(404, "Заявка не найдена")
    if request.user_id != user_id:
        raise HTTPException(403, "Это не ваша заявка")
    if request.status != WithdrawalStatus.pending:
        raise HTTPException(400, "Отменить можно только заявку, ожидающую обработки")

    # Возвращаем зарезервированную сумму на баланс
    user = db.query(User).filter(User.id == user_id).first()
    user.balance = (user.balance or 0) + request.amount
    db.add(Transaction(
        user_id=user_id,
        amount=request.amount,
        type=TransactionType.withdraw_refund,
    ))

    request.status = WithdrawalStatus.cancelled
    request.resolved_at = datetime.utcnow().isoformat()
    request.comment = "Отменено пользователем"
    db.commit()

    return {"message": "Заявка отменена, средства возвращены на баланс", "refunded": request.amount}


# -------------------------------------------------------------------- модератор

@router.get("/admin/withdrawals")
def list_withdrawals_admin(
    status_filter: str = None,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")

    query = db.query(WithdrawalRequest)
    if status_filter:
        try:
            query = query.filter(WithdrawalRequest.status == WithdrawalStatus(status_filter))
        except ValueError:
            raise HTTPException(400, "Неизвестный статус заявки")

    items = query.order_by(WithdrawalRequest.id.desc()).all()
    result = []
    for w in items:
        item = _serialize(w, reveal_requisites=True)  # модератору нужны полные реквизиты
        owner = db.query(User).filter(User.id == w.user_id).first()
        item["user_name"] = owner.name if owner else "—"
        item["user_email"] = owner.email if owner else "—"
        item["user_balance"] = owner.balance if owner else 0
        result.append(item)
    return result


@router.post("/admin/withdrawals/{withdrawal_id}/review")
def review_withdrawal_admin(
    withdrawal_id: int,
    req: WithdrawalReviewRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")

    request = db.query(WithdrawalRequest).filter(WithdrawalRequest.id == withdrawal_id).first()
    if not request:
        raise HTTPException(404, "Заявка не найдена")
    if request.status != WithdrawalStatus.pending:
        raise HTTPException(400, "Заявка уже обработана")

    owner = db.query(User).filter(User.id == request.user_id).first()
    if not owner:
        raise HTTPException(404, "Пользователь заявки не найден")

    request.resolved_at = datetime.utcnow().isoformat()

    if req.action == "approve":
        # Деньги уже списаны при подаче заявки — здесь только фиксируем факт выплаты
        request.status = WithdrawalStatus.paid
        request.comment = req.comment or "Выплачено"
        _notify(
            db, owner.id, "Выплата отправлена",
            f"Заявка на вывод {request.amount} ₽ одобрена. Средства отправлены по указанным реквизитам.",
        )
    elif req.action == "reject":
        # Возвращаем зарезервированную сумму на баланс
        owner.balance = (owner.balance or 0) + request.amount
        db.add(Transaction(
            user_id=owner.id,
            amount=request.amount,
            type=TransactionType.withdraw_refund,
        ))
        request.status = WithdrawalStatus.rejected
        request.comment = req.comment or "Заявка отклонена модератором"
        _notify(
            db, owner.id, "Заявка на вывод отклонена",
            f"Заявка на вывод {request.amount} ₽ отклонена: {request.comment}. "
            f"Средства возвращены на баланс.",
        )
    else:
        raise HTTPException(400, "Неверное действие: approve или reject")

    db.commit()
    return {
        "message": "Заявка обработана",
        "status": request.status.value,
        "refunded": request.amount if request.status == WithdrawalStatus.rejected else 0,
    }
