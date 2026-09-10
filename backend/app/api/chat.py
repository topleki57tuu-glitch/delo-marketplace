import asyncio
import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.core.security import oauth2_scheme, decode_token
from app.models import Message, Task, User, Notification
from app.schemas import MessageCreate
from app.services.websocket_manager import manager

router = APIRouter(tags=["Chat"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

@router.get("/tasks/{task_id}/messages")
def get_messages(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    role = payload.get("role")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    if role == "customer" and task.customer_id != user_id:
        raise HTTPException(403, "Нет доступа")
    if role == "specialist" and task.executor_id != user_id:
        raise HTTPException(403, "Нет доступа")

    messages = db.query(Message).filter(Message.task_id == task_id).order_by(Message.id).all()
    result = []
    for m in messages:
        sender = db.query(User).filter(User.id == m.sender_id).first()
        result.append({
            "id": m.id,
            "task_id": m.task_id,
            "sender_id": m.sender_id,
            "text": m.text,
            "created_at": m.created_at,
            "sender_name": sender.name or sender.email if sender else "Unknown"
        })
    return result

@router.post("/tasks/{task_id}/messages")
async def post_message(task_id: int, message: MessageCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    role = payload.get("role")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    if role == "customer" and task.customer_id != user_id:
        raise HTTPException(403, "Нет доступа")
    if role == "specialist" and task.executor_id != user_id:
        raise HTTPException(403, "Нет доступа")

    new_message = Message(task_id=task_id, sender_id=user_id, text=message.text)
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    sender = db.query(User).filter(User.id == user_id).first()
    recipient_id = task.executor_id if role == "customer" else task.customer_id
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
    role = payload.get("role")

    db = SessionLocal()
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        db.close()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if role == "customer" and task.customer_id != user_id:
        db.close()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if role == "specialist" and task.executor_id != user_id:
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
