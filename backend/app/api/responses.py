from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import Response, Task, User, Review, TaskStatus, UserRole, Notification
from app.schemas import ResponseCreate

router = APIRouter(tags=["Responses"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

def user_online(user: User) -> bool:
    from datetime import datetime
    if not user or not user.last_seen:
        return False
    try:
        return (datetime.utcnow() - datetime.fromisoformat(user.last_seen)).total_seconds() < 120
    except Exception:
        return False

@router.post("/tasks/{task_id}/responses")
def create_response(task_id: int, response: ResponseCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    if payload.get("role") != "specialist":
        raise HTTPException(403, "Откликаться могут только специалисты")
    
    specialist_id = int(payload.get("sub"))
    specialist = db.query(User).filter(User.id == specialist_id).first()
    if not specialist:
        raise HTTPException(404, "Специалист не найден")

    # Монетизация: PRO — безлимит, иначе списываем 1 отклик
    if not specialist.is_pro:
        if (specialist.response_credits or 0) <= 0:
            raise HTTPException(402, "Отклики закончились. Пополните баланс или оформите PRO в профиле")
        specialist.response_credits -= 1

    new_response = Response(
        task_id=task_id,
        specialist_id=specialist_id,
        text=response.text,
        proposed_price=response.proposed_price,
        estimated_days=response.estimated_days
    )
    db.add(new_response)

    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        db.add(Notification(
            user_id=task.customer_id,
            type="new_response",
            title="Новый отклик на заказ!",
            text=f"{'PRO ★ ' if specialist.is_pro else ''}{specialist.name or specialist.email} откликнулся на задачу \"{task.title}\"" + (f" — {response.proposed_price} ₽" if response.proposed_price else ""),
            task_id=task_id
        ))
    db.commit()
    return {"message": "Отклик отправлен", "credits_left": None if specialist.is_pro else specialist.response_credits}

@router.get("/tasks/{task_id}/responses")
def get_task_responses(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    responses = db.query(Response).filter(Response.task_id == task_id).all()
    result = []
    for r in responses:
        spec = db.query(User).filter(User.id == r.specialist_id).first()
        rating = None
        completed_tasks = 0
        if spec:
            reviews = db.query(Review).filter(Review.specialist_id == spec.id, Review.target == "specialist").all()
            if reviews:
                rating = round(sum(rev.rating for rev in reviews) / len(reviews), 1)
            completed_tasks = db.query(Task).filter(
                Task.executor_id == spec.id,
                Task.status == TaskStatus.completed
            ).count()

        result.append({
            "id": r.id,
            "text": r.text,
            "specialist_id": r.specialist_id,
            "specialist_name": spec.name if spec else "Аноним",
            "specialist_avatar": spec.avatar if spec else None,
            "specialist_email": spec.email if spec else "",
            "specialist_rating": rating,
            "specialist_completed_tasks": completed_tasks,
            "specialist_verified": spec.verified if spec else False,
            "specialist_city": spec.city if spec else None,
            "specialist_online": user_online(spec) if spec else False,
            "specialist_pro": spec.is_pro if spec else False,
            "proposed_price": r.proposed_price,
            "estimated_days": r.estimated_days
        })
    result.sort(key=lambda x: (not x["specialist_pro"], -(x["specialist_rating"] or 0)))
    return result
