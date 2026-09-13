import asyncio
import json
import time
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.core.security import oauth2_scheme, decode_token
from app.core.logging import log_security_event
from app.models import Message, Task, User, Notification, TaskStatus
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
            "task_status": t.status.value if hasattr(t.status, "value") else str(t.status),
            "task_budget": t.budget,
            "other_user_id": other_user_id,
            "other_user_name": (other_user.name or other_user.email) if other_user else "Собеседник",
            "other_user_avatar": other_user.avatar if other_user else None,
            "other_user_role": "Исполнитель" if other_user and other_user.id == t.executor_id else "Заказчик",
            "last_message": last_msg.text if last_msg else None,
            "last_message_time": last_msg.created_at if last_msg else None,
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
    result = []
    for m in messages:
        sender = db.query(User).filter(User.id == m.sender_id).first()
        result.append({
            "id": m.id,
            "task_id": m.task_id,
            "sender_id": m.sender_id,
            "text": m.text,
            "file_url": m.file_url,
            "file_name": m.file_name,
            "file_type": m.file_type,
            "is_read": bool(m.is_read),
            "created_at": m.created_at,
            "sender_name": sender.name or sender.email if sender else "Unknown"
        })
    return result

@router.put("/tasks/{task_id}/messages/read")
def mark_messages_read(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
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
async def post_message(task_id: int, message: MessageCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
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

    new_message = Message(
        task_id=task_id,
        sender_id=user_id,
        text=message.text,
        file_url=message.file_url,
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
        "file_url": message.file_url,
        "file_name": message.file_name,
        "file_type": message.file_type,
        "is_read": False,
        "created_at": new_message.created_at,
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
