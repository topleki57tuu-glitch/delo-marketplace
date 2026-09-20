import asyncio
import json
import re
import time
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.core.enums import enum_value
from app.core.csrf import verify_csrf
from app.core.security import oauth2_scheme, decode_token, file_url_with_token
from app.core.logging import log_security_event
from app.models import Message, StoredFile, Task, User, Notification, TaskStatus
from app.schemas import MessageCreate
from app.services.websocket_manager import manager

router = APIRouter(tags=["Chat"])

# WebSocket rate limiting: последние отправки сообщений по user_id
_ws_rate_limit: Dict[int, List[float]] = {}
WS_MESSAGE_LIMIT = 10  # Максимум сообщений
WS_WINDOW_SECONDS = 60  # За 60 секунд


def ws_rate_limit_check(user_id: int) -> bool:
    """Проверяет rate limit для WebSocket сообщений.

    Лимит: 10 сообщений за 60 секунд на пользователя.
    Возвращает True если лимит превышен.
    """
    now = time.time()

    # Получаем историю отправок пользователя
    if user_id not in _ws_rate_limit:
        _ws_rate_limit[user_id] = []

    # Очищаем старые записи (вне окна)
    _ws_rate_limit[user_id] = [
        timestamp for timestamp in _ws_rate_limit[user_id]
        if now - timestamp < WS_WINDOW_SECONDS
    ]

    # Проверяем лимит
    if len(_ws_rate_limit[user_id]) >= WS_MESSAGE_LIMIT:
        return True  # Превышен

    # Добавляем текущую отправку
    _ws_rate_limit[user_id].append(now)
    return False

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


# ---------------------------------------------------------------------------
# Вложения: что можно прикрепить и кому можно показать
#
# `file_url` в сообщении — это ссылка `/files/<id>`, а не содержимое файла.
# Хранится она как есть, а подпись (`?token=...`) выдаётся при отдаче, потому
# что браузер не прикладывает заголовок Authorization к запросу картинки из
# `<img>`.
#
# Проблема была в том, что подпись считается от ОДНОГО ЛИШЬ id файла:
#
#     def sign_file_token(file_id):   # app/core/security.py:233
#         return "f1" + hmac(SECRET_KEY, f"file:{file_id}")
#
# Ни пользователя, ни сделки, ни срока в ней нет, а `file_url` приходит от
# клиента. Значит участник любой сделки мог назвать id чужого приватного
# вложения, получить на него валидную подпись и прочитать файл — при том что
# доступ к самой переписке, где этот файл лежит, ему закрыт (403).
#
# Поэтому проверок две:
#   1. при отправке — прикрепить можно только СВОЙ файл;
#   2. при отдаче — подпись выдаётся только на файл, который виден участникам
#      этой сделки. Второй рубеж нужен для строк, попавших в базу до правки.
# ---------------------------------------------------------------------------
_ATTACHMENT_RE = re.compile(r"^/files/(\d+)")


def _attachment_file_id(url: Optional[str]) -> Optional[int]:
    """id файла из внутренней ссылки `/files/<id>`; None для всего остального.

    Внешние http(s)-ссылки сюда не попадают: подпись к ним не добавляется,
    и прав на файлы платформы они не дают.
    """
    if not url:
        return None
    match = _ATTACHMENT_RE.match(url)
    return int(match.group(1)) if match else None


def _require_own_attachment(db: Session, url: Optional[str], user_id: int) -> Optional[str]:
    """Прикрепить можно только файл, который загрузил сам отправитель.

    Возвращает каноническую ссылку `/files/<id>` (без чужого query) либо url
    без изменений, если это внешний адрес.
    """
    file_id = _attachment_file_id(url)
    if file_id is None:
        return url

    stored = db.query(StoredFile).filter(StoredFile.id == file_id).first()
    if not stored:
        raise HTTPException(400, "Файл не найден — загрузите его через POST /upload/image")
    if stored.owner_id != user_id:
        raise HTTPException(403, "Прикрепить можно только свой файл")
    return f"/files/{stored.id}"


def _visible_attachment_ids(db: Session, task: Task, messages) -> set:
    """Файлы из вложений, которые положено видеть участникам этой сделки."""
    ids = {
        file_id
        for file_id in (_attachment_file_id(m.file_url) for m in messages)
        if file_id is not None
    }
    if not ids:
        return set()

    participants = {task.customer_id, task.executor_id} - {None}
    visible = set()
    for row in db.query(StoredFile).filter(StoredFile.id.in_(ids)).all():
        # Публичный файл открыт всем: подпись ему ничего не добавляет.
        if not row.is_private or row.owner_id in participants:
            visible.add(row.id)
    return visible


def _attachment_url(url: Optional[str], visible: set) -> Optional[str]:
    """Ссылка с подписью — только если файл виден участникам сделки.

    Для невидимого файла возвращаем ссылку без подписи: `GET /files/{id}`
    на приватный файл ответит 403, то есть доступ не появится, а сообщение
    останется читаемым.
    """
    file_id = _attachment_file_id(url)
    if file_id is None or file_id in visible:
        return file_url_with_token(url)
    return f"/files/{file_id}"


@router.get("/chats")
def get_user_chats(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    Возвращает список всех активных диалогов текущего пользователя (заказчика или исполнителя)
    с метаданными задачи, собеседника, последним сообщением и количеством непрочитанных.
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    tasks = db.query(Task).filter(
        (Task.customer_id == user_id) | (Task.executor_id == user_id)
    ).order_by(Task.id.desc()).all()

    dialogs = []
    for t in tasks:
        other_user_id = t.executor_id if t.customer_id == user_id else t.customer_id
        other_user = db.query(User).filter(User.id == other_user_id).first() if other_user_id else None

        last_msg = db.query(Message).filter(Message.task_id == t.id).order_by(Message.id.desc()).first()
        unread_count = db.query(Message).filter(
            Message.task_id == t.id,
            Message.sender_id != user_id,
            Message.is_read == False
        ).count()

        dialogs.append({
            "task_id": t.id,
            "task_title": t.title,
            "task_status": enum_value(t.status),
            "task_budget": t.budget,
            "other_user_id": other_user_id,
            "other_user_name": (other_user.name or other_user.email) if other_user else "Собеседник",
            "other_user_avatar": other_user.avatar if other_user else None,
            "other_user_role": "Исполнитель" if other_user and other_user.id == t.executor_id else "Заказчик",
            "last_message": last_msg.text if last_msg else None,
            # Строка, а не datetime. Схема `ChatDialogOut` объявляет это поле
            # как `str`, и в списке ниже значения сравниваются между собой:
            # `datetime` рядом с `""` от пустого диалога давали TypeError и
            # роняли весь список чатов. ISO-строки сравниваются лексикографически
            # и в UTC совпадают с хронологическим порядком.
            "last_message_time": last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None,
            "unread_count": unread_count
        })

    dialogs.sort(key=lambda d: d["last_message_time"] or "", reverse=True)
    return dialogs

@router.get("/tasks/{task_id}/messages")
def get_messages(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    # Доступ по участию в сделке, а не по роли из JWT: после переключения роли
    # токен ещё до 7 дней несёт прежнюю роль и ложно отвергал участника
    if user_id not in (task.customer_id, task.executor_id):
        raise HTTPException(403, "Нет доступа")

    # Автоматически отмечаем прочитанными входящие сообщения при открытии чата
    db.query(Message).filter(
        Message.task_id == task_id,
        Message.sender_id != user_id,
        Message.is_read == False
    ).update({"is_read": True})
    db.commit()

    messages = db.query(Message).filter(Message.task_id == task_id).order_by(Message.id).all()

    # Файлы, которые участникам этой сделки видеть положено, — одним запросом
    # на весь список, а не по запросу на сообщение.
    visible = _visible_attachment_ids(db, task, messages)

    result = []
    for m in messages:
        sender = db.query(User).filter(User.id == m.sender_id).first()
        result.append({
            "id": m.id,
            "task_id": m.task_id,
            "sender_id": m.sender_id,
            "text": m.text,
            # Подпись — только на файл, который виден участникам сделки: сама
            # по себе она считается от одного id и никаких прав не несёт.
            "file_url": _attachment_url(m.file_url, visible),
            "file_name": m.file_name,
            "file_type": m.file_type,
            "is_read": bool(m.is_read),
            # `MessageOut.created_at` — тоже `str`: приводим здесь, чтобы
            # объявленный контракт совпадал с фактом и эндпоинт не начал
            # падать 500, как только кто-нибудь добавит ему `response_model`.
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "sender_name": sender.name or sender.email if sender else "Unknown"
        })
    return result

@router.put("/tasks/{task_id}/messages/read")
def mark_messages_read(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    # Помечать прочитанным можно только переписку своей сделки —
    # иначе любой авторизованный пользователь сбрасывал бы чужие непрочитанные.
    if user_id not in (task.customer_id, task.executor_id):
        raise HTTPException(403, "Нет доступа")

    updated = db.query(Message).filter(
        Message.task_id == task_id,
        Message.sender_id != user_id,
        Message.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"message": "Сообщения прочитаны", "updated_count": updated}

@router.post("/tasks/{task_id}/messages")
async def post_message(task_id: int, message: MessageCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # WebSocket rate limiting
    if ws_rate_limit_check(user_id):
        log_security_event(
            event_type="ws_rate_limit_exceeded",
            user_id=user_id,
            details=f"task_id={task_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много сообщений. Подождите минуту."
        )

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    # Доступ по участию в сделке (роль из JWT может быть устаревшей)
    if user_id not in (task.customer_id, task.executor_id):
        raise HTTPException(403, "Нет доступа")

    # Прикрепить можно только свой файл. Без этой проверки `file_url` —
    # обычный параметр запроса, и участник сделки мог назвать в нём id чужого
    # приватного вложения, чтобы получить на него валидную подпись.
    file_url = _require_own_attachment(db, message.file_url, user_id)

    new_message = Message(
        task_id=task_id,
        sender_id=user_id,
        text=message.text,
        file_url=file_url,
        file_name=message.file_name,
        file_type=message.file_type,
        is_read=False
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    sender = db.query(User).filter(User.id == user_id).first()
    recipient_id = task.executor_id if task.customer_id == user_id else task.customer_id
    if recipient_id:
        # Формируем текст уведомления
        notification_text = message.text[:60] if message.text else ""
        if message.file_name:
            notification_text = f"📎 {message.file_name}"
        if len(message.text) > 60:
            notification_text += "..."

        db.add(Notification(
            user_id=recipient_id,
            type="message",
            title="Новое сообщение",
            text=f"{sender.name or sender.email}: {notification_text}",
            task_id=task_id
        ))
        db.commit()

    message_dict = {
        "id": new_message.id,
        "task_id": task_id,
        "sender_id": user_id,
        "text": message.text,
        # Та же проверка, что и в GET /messages: подпись выдаётся только на
        # файл, видимый участникам этой сделки.
        "file_url": _attachment_url(
            message.file_url, _visible_attachment_ids(db, task, [new_message])
        ),
        "file_name": message.file_name,
        "file_type": message.file_type,
        "is_read": False,
        "created_at": new_message.created_at.isoformat() if new_message.created_at else None,
        "sender_name": sender.name or sender.email if sender else "Unknown"
    }

    await manager.broadcast(message_dict, task_id)
    return message_dict

@router.websocket("/ws/tasks/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: int, token: Optional[str] = None):
    already_accepted = False
    if not token:
        await websocket.accept()
        already_accepted = True
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10)
            data = json.loads(raw)
            token = data.get("token")
        except Exception:
            token = None
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_token_or_401(token)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = int(payload.get("sub"))

    db = SessionLocal()
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        db.close()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    # Доступ по участию в сделке (роль из JWT может быть устаревшей)
    if user_id not in (task.customer_id, task.executor_id):
        db.close()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    db.close()

    if not already_accepted:
        await websocket.accept()

    if task_id not in manager.active_connections:
        manager.active_connections[task_id] = []
    manager.active_connections[task_id].append(websocket)

    db_session = SessionLocal()
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
                event_type = data.get("type")

                # Обработка typing событий
                if event_type == "typing_start":
                    sender = db_session.query(User).filter(User.id == user_id).first()
                    await manager.broadcast_typing(
                        task_id=task_id,
                        user_id=user_id,
                        user_name=sender.name or sender.email if sender else "Пользователь",
                        is_typing=True
                    )
                elif event_type == "typing_stop":
                    sender = db_session.query(User).filter(User.id == user_id).first()
                    await manager.broadcast_typing(
                        task_id=task_id,
                        user_id=user_id,
                        user_name=sender.name or sender.email if sender else "Пользователь",
                        is_typing=False
                    )
            except (json.JSONDecodeError, AttributeError):
                # Игнорируем невалидные сообщения
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, task_id)
    finally:
        db_session.close()
