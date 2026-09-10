import json
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import User, Review, Task, UserRole, TaskStatus
from app.schemas import ProfileUpdate

router = APIRouter(tags=["Users"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

def user_online(user: User) -> bool:
    if not user.last_seen:
        return False
    try:
        return (datetime.utcnow() - datetime.fromisoformat(user.last_seen)).total_seconds() < 120
    except Exception:
        return False

@router.get("/users/me")
def get_profile(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    rating = None
    completed_tasks = 0
    if user.role == UserRole.specialist:
        reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == "specialist").all()
        if reviews:
            rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
        completed_tasks = db.query(Task).filter(
            Task.executor_id == user.id,
            Task.status == TaskStatus.completed
        ).count()
    else:
        reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == "customer").all()
        if reviews:
            rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
        completed_tasks = db.query(Task).filter(
            Task.customer_id == user.id,
            Task.status == TaskStatus.completed
        ).count()

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "name": user.name,
        "bio": user.bio,
        "balance": user.balance,
        "city": user.city,
        "phone": user.phone,
        "avatar": user.avatar,
        "skills": user.skills,
        "portfolio": user.portfolio,
        "rating": rating,
        "verified": user.verified,
        "is_pro": user.is_pro,
        "pro_until": user.pro_until,
        "response_credits": user.response_credits,
        "completed_tasks": completed_tasks,
        "online": user_online(user),
        "last_seen": user.last_seen
    }

@router.put("/users/me")
def update_profile(profile: ProfileUpdate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    if profile.name is not None:
        user.name = profile.name
    if profile.bio is not None:
        user.bio = profile.bio
    if profile.city is not None:
        user.city = profile.city
    if profile.phone is not None:
        user.phone = profile.phone
    if profile.avatar is not None:
        user.avatar = profile.avatar
    if profile.skills is not None:
        user.skills = profile.skills
    if profile.portfolio is not None:
        user.portfolio = profile.portfolio

    db.commit()
    return {"message": "Профиль успешно обновлён"}

@router.post("/users/me/switch-role")
def switch_role(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    
    new_role = UserRole.specialist if user.role == UserRole.customer else UserRole.customer
    user.role = new_role
    db.commit()
    return {"message": "Роль изменена", "role": new_role.value}

@router.get("/users/{user_id}/public")
def get_public_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    
    review_target = "specialist" if user.role == UserRole.specialist else "customer"
    rating = None
    reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == review_target).all()
    if reviews:
        rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
    
    if user.role == UserRole.specialist:
        completed_tasks = db.query(Task).filter(
            Task.executor_id == user.id,
            Task.status == TaskStatus.completed
        ).count()
    else:
        completed_tasks = db.query(Task).filter(
            Task.customer_id == user.id,
            Task.status == TaskStatus.completed
        ).count()

    return {
        "id": user.id,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "name": user.name,
        "bio": user.bio,
        "rating": rating,
        "reviews_count": len(reviews),
        "city": user.city,
        "avatar": user.avatar,
        "portfolio": user.portfolio,
        "skills": user.skills,
        "verified": user.verified,
        "is_pro": user.is_pro,
        "completed_tasks": completed_tasks,
        "online": user_online(user),
        "last_seen": user.last_seen
    }
