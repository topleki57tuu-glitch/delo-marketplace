import asyncio
import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.core.security import oauth2_scheme, decode_token
from app.models import Message, Task, User, Notification, TaskStatus
from app.schemas import MessageCreate
from app.services.websocket_manager import manager

router = APIRouter(tags=["Chat"])

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

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    # Доступ по участию в сделке (роль из JWT может быть устаревшей)
    if user_id not in (task.customer_id, task.executor_id):
        raise HTTPException(403, "Нет доступа")

    new_message = Message(task_id=task_id, sender_id=user_id, text=message.text, is_read=False)
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    sender = db.query(User).filter(User.id == user_id).first()
    recipient_id = task.executor_id if task.customer_id == user_id else task.customer_id
    if recipient_id:
        db.add(Notification(
            user_id=recipient_id,
            type="message",
            title="Новое сообщение",
            text=f"{sender.name or sender.email}: {message.text[:60]}{'...' if len(message.text) > 60 else ''}",
            task_id=task_id
        ))
        db.commit()

    message_dict = {
        "id": new_message.id,
        "task_id": task_id,
        "sender_id": user_id,
        "text": message.text,
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

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, task_id)
