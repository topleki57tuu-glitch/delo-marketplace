from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response as FastResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    oauth2_scheme,
    decode_token,
    rate_limit,
    verify_file_token,
)
from app.core.csrf import verify_csrf
from app.models import StoredFile
from file_utils import validate_image, validate_document, is_image_ctype

router = APIRouter(tags=["Files"])

# Область видимости файла при загрузке.
SCOPE_PUBLIC = "public"
SCOPE_PRIVATE = "private"

# Лимит на загрузку. Без него авторизованный пользователь заливает базу
# под завязку: файл лежит в БД целиком (`StoredFile.data`), а размер одного
# файла — до 5 МБ. Удалять файлы до появления `DELETE /files/{id}` было нечем.
UPLOAD_RATE_LIMIT = 30
UPLOAD_RATE_WINDOW = 300


def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


def _current_user_id(token: str) -> int:
    return int(decode_token_or_401(token).get("sub"))


@router.post("/upload/image")
def upload_image(
    request: Request,
    file: UploadFile = File(...),
    scope: str = SCOPE_PUBLIC,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),
):
    """Загрузить изображение и получить ссылку на него.

    `scope=public` (по умолчанию) — аватар, фото задания или товара,
    портфолио: отдаётся по прямой ссылке `/files/{id}`.

    `scope=private` — вложение личной переписки: файл отдаётся только по
    ссылке с подписью, которую сервер выдаёт участникам сделки вместе с
    сообщением. Прямой `/files/{id}` для такого файла вернёт 403.
    """
    rate_limit(request, "upload_image", limit=UPLOAD_RATE_LIMIT, window_sec=UPLOAD_RATE_WINDOW)

    user_id = _current_user_id(token)

    if scope not in (SCOPE_PUBLIC, SCOPE_PRIVATE):
        raise HTTPException(400, f"Неизвестная область видимости: {scope}")

    safe_ctype = validate_image(file)
    data = file.file.read()
    stored = StoredFile(
        filename=file.filename or "image.jpg",
        content_type=safe_ctype,
        data=data,
        owner_id=user_id,
        is_private=(scope == SCOPE_PRIVATE),
    )
    db.add(stored)
    db.commit()
    db.refresh(stored)
    return {
        "file_id": stored.id,
        "url": f"/files/{stored.id}",
        "filename": stored.filename,
        "scope": scope,
    }


@router.post("/upload/file")
def upload_file(
    request: Request,
    file: UploadFile = File(...),
    scope: str = SCOPE_PRIVATE,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),
):
    """Загрузить вложение-документ (PDF, docx, xlsx, zip).

    Отдельный эндпоинт, а не расширение `/upload/image`: у документов другая
    проверка содержимого и другой способ отдачи. Отдаются они только как
    `attachment` — браузер их скачивает, а не открывает, поэтому загрузить
    HTML под именем `.pdf` и получить stored XSS нельзя.

    Область видимости по умолчанию приватная: документы присылают в личной
    переписке, а не в публичной ленте.
    """
    rate_limit(request, "upload_file", limit=UPLOAD_RATE_LIMIT, window_sec=UPLOAD_RATE_WINDOW)

    user_id = _current_user_id(token)

    if scope not in (SCOPE_PUBLIC, SCOPE_PRIVATE):
        raise HTTPException(400, f"Неизвестная область видимости: {scope}")

    safe_ctype = validate_document(file)
    data = file.file.read()
    stored = StoredFile(
        filename=file.filename or "document",
        content_type=safe_ctype,
        data=data,
        owner_id=user_id,
        is_private=(scope == SCOPE_PRIVATE),
    )
    db.add(stored)
    db.commit()
    db.refresh(stored)
    return {
        "file_id": stored.id,
        "url": f"/files/{stored.id}",
        "filename": stored.filename,
        "scope": scope,
    }


@router.get("/files/{file_id}")
def get_file(
    file_id: int,
    token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Отдать файл.

    Публичные файлы отдаются по прямой ссылке — иначе не работал бы
    `<img src="/files/N">` на аватаре или фото задания.

    Приватные требуют подписи в query-строке. Подпись не заменяет авторизацию,
    а заменяет её там, где заголовок Authorization физически не отправить:
    браузер не прикладывает его к запросу картинки из `<img>`. Подпись
    считается из SECRET_KEY и выдаётся только тем, кому файл положено видеть.
    """
    stored = db.query(StoredFile).filter(StoredFile.id == file_id).first()
    if not stored:
        raise HTTPException(404, "Файл не найден")

    if stored.is_private and not verify_file_token(file_id, token):
        raise HTTPException(403, "Файл доступен только по ссылке с подписью")

    # Изображения отдаём инлайном (иначе не работает `<img src>`), всё
    # остальное — только на скачивание. Тип взят из сигнатуры при загрузке,
    # а не из заголовка клиента, поэтому подделать его нельзя.
    if is_image_ctype(stored.content_type):
        media_type = stored.content_type
        disposition = None
    else:
        media_type = "application/octet-stream"
        # Имя чистим от кавычек и переводов строк: заголовок не должен
        # уметь разорваться и дописать свои заголовки.
        safe_name = (stored.filename or "file").replace('"', "").replace("\r", "").replace("\n", "")
        disposition = f'attachment; filename="{safe_name}"'

    headers = {
        # Приватные файлы кэшировать публично нельзя: подпись утекала бы
        # в общие кэши вместе с картинкой.
        "Cache-Control": (
            "private, max-age=3600" if stored.is_private
            else "public, max-age=31536000"
        ),
        "X-Content-Type-Options": "nosniff",
    }
    if disposition:
        headers["Content-Disposition"] = disposition

    return FastResponse(
        content=stored.data,
        media_type=media_type,
        headers=headers,
    )


@router.delete("/files/{file_id}")
def delete_file(
    file_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),
):
    """Удалить свой файл.

    До этого эндпоинта загруженные файлы не удалялись вообще: они лежали в БД
    навсегда, а `GET /files/{id}` отдавал их по `max-age=31536000`.

    Удалить можно только то, что загрузил сам. Записи без `owner_id`
    (сделанные до появления колонки) не удаляются ничьей рукой: владелец
    неизвестен, а приписать его первому желающему нельзя.
    """
    user_id = _current_user_id(token)

    stored = db.query(StoredFile).filter(StoredFile.id == file_id).first()
    if not stored:
        raise HTTPException(404, "Файл не найден")

    if stored.owner_id is None:
        raise HTTPException(
            409,
            "Файл загружен до появления учёта владельцев — удалить его через API нельзя",
        )
    if stored.owner_id != user_id:
        raise HTTPException(403, "Можно удалять только свои файлы")

    db.delete(stored)
    db.commit()
    return {"message": "Файл удалён", "file_id": file_id}
