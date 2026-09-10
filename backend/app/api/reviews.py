from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import Review, Task, User, TaskStatus, UserRole
from app.schemas import ReviewCreate

router = APIRouter(tags=["Reviews"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

@router.get("/users/{user_id}/reviews")
def get_user_reviews(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    review_target = "specialist" if user.role == UserRole.specialist else "customer"
    reviews = db.query(Review).filter(
        Review.specialist_id == user_id, Review.target == review_target
    ).order_by(Review.id.desc()).all()
    result = []
    for r in reviews:
        reviewer = db.query(User).filter(User.id == r.reviewer_id).first()
        task = db.query(Task).filter(Task.id == r.task_id).first()
        reviewer_role = "Специалист" if (reviewer and reviewer.role == UserRole.specialist) else "Заказчик"
        result.append({
            "id": r.id,
            "rating": r.rating,
            "comment": r.comment,
            "reviewer_name": reviewer.name if reviewer and reviewer.name else reviewer_role,
            "reviewer_avatar": reviewer.avatar if reviewer else None,
            "reviewer_role": reviewer_role,
            "task_title": task.title if task else None,
            "task_id": r.task_id
        })
    return result

@router.post("/tasks/{task_id}/review")
def create_review(task_id: int, review: ReviewCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    role = payload.get("role")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

    if task.status != TaskStatus.completed:
        raise HTTPException(400, "Можно оставлять отзывы только на завершенные заказы")

    if role == "customer" and task.customer_id == user_id:
        if not task.executor_id:
            raise HTTPException(400, "У заказа нет исполнителя")
        reviewee_id, target = task.executor_id, "specialist"
    elif role == "specialist" and task.executor_id == user_id:
        reviewee_id, target = task.customer_id, "customer"
    else:
        raise HTTPException(403, "Отзыв доступен только участникам заказа")

    existing = db.query(Review).filter(Review.task_id == task_id, Review.reviewer_id == user_id).first()
    if existing:
        raise HTTPException(400, "Вы уже оставили отзыв на этот заказ")

    new_review = Review(
        task_id=task_id,
        reviewer_id=user_id,
        specialist_id=reviewee_id,
        rating=review.rating,
        comment=review.comment,
        target=target
    )
    db.add(new_review)
    db.commit()
    return {"message": "Отзыв успешно добавлен"}
