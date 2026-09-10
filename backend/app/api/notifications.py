from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import Notification

router = APIRouter(prefix="/notifications", tags=["Notifications"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

@router.get("/")
def get_notifications(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    notifs = db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.id.desc()).limit(50).all()
    unread_count = db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).count()
    return {
        "notifications": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "text": n.text,
                "task_id": n.task_id,
                "is_read": n.is_read,
                "created_at": n.created_at
            }
            for n in notifs
        ],
        "unread_count": unread_count
    }

@router.post("/read-all")
def mark_all_notifications_read(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).update({"is_read": True})
    db.commit()
    return {"message": "Все уведомления прочитаны"}

@router.put("/{notif_id}/read")
def mark_notification_read(notif_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == user_id).first()
    if notif:
        notif.is_read = True
        db.commit()
    return {"message": "Уведомление прочитано"}
