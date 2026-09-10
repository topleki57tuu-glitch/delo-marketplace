import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.models import (
    Task, User, Response, TaskCategory, TaskStatus, UserRole,
    Notification, Transaction, TransactionType, Dispute, DisputeStatus
)
from app.schemas import TaskCreate, TaskOut
from geocoding import geocode_address
from pydantic import BaseModel

router = APIRouter(prefix="/tasks", tags=["Tasks"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

class TaskImagesDeleteRequest(BaseModel):
    urls_to_delete: List[str]

@router.post("/")
def create_task(task: TaskCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    if payload.get("role") != "customer":
        raise HTTPException(403, "Создавать задания могут только заказчики")

    latitude = task.latitude
    longitude = task.longitude

    if task.city and not task.is_remote and (latitude is None or longitude is None):
        coords = geocode_address(task.city, task.address)
        if coords:
            latitude, longitude = coords

    new_task = Task(
        title=task.title,
        description=task.description,
        budget=task.budget,
        category=task.category,
        customer_id=int(payload.get("sub")),
        city=task.city,
        address=task.address,
        latitude=latitude,
        longitude=longitude,
        deadline=task.deadline,
        is_remote=task.is_remote,
        images=task.images
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return {"message": "Задание создано", "task_id": new_task.id}

@router.get("/")
def get_tasks(
    category: Optional[TaskCategory] = None,
    search: Optional[str] = None,
    city: Optional[str] = None,
    is_remote: Optional[bool] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Task)
    if category:
        query = query.filter(Task.category == category)
    if search:
        query = query.filter(Task.title.ilike(f"%{search}%") | Task.description.ilike(f"%{search}%"))
    if city:
        query = query.filter(Task.city == city)
    if is_remote is not None:
        query = query.filter(Task.is_remote == is_remote)
    if status_filter:
        query = query.filter(Task.status == status_filter)
    
    tasks = query.order_by(Task.id.desc()).all()
    return tasks

@router.get("/{task_id}")
def get_task_detail(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")
    customer = db.query(User).filter(User.id == task.customer_id).first()
    responses_count = db.query(Response).filter(Response.task_id == task_id).count()
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "budget": task.budget,
        "category": task.category.value if hasattr(task.category, "value") else str(task.category),
        "customer_id": task.customer_id,
        "customer_name": customer.name if customer else None,
        "customer_avatar": customer.avatar if customer else None,
        "executor_id": task.executor_id,
        "status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "has_open_dispute": db.query(Dispute).filter(
            Dispute.task_id == task_id, Dispute.status == DisputeStatus.open
        ).first() is not None,
        "city": task.city,
        "address": task.address,
        "latitude": task.latitude,
        "longitude": task.longitude,
        "deadline": task.deadline,
        "is_remote": task.is_remote,
        "images": task.images,
        "responses_count": responses_count
    }

@router.delete("/{task_id}/images")
def delete_task_images(task_id: int, req: TaskImagesDeleteRequest, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")
    if task.customer_id != user_id:
        raise HTTPException(403, "Удалять фото может только автор заказа")
    try:
        imgs = json.loads(task.images) if task.images else []
    except Exception:
        imgs = []
    new_imgs = [u for u in imgs if u not in req.urls_to_delete]
    task.images = json.dumps(new_imgs) if new_imgs else None
    db.commit()
    return {"message": "Фото удалено", "images": new_imgs}

@router.put("/{task_id}/complete")
def complete_task(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")
    if task.customer_id != user_id:
        raise HTTPException(403, "Завершить заказ может только его создатель")
    if task.status == TaskStatus.completed:
        raise HTTPException(400, "Заказ уже завершён")
    if task.status == TaskStatus.cancelled:
        raise HTTPException(400, "Заказ отменён")
    if task.status == TaskStatus.disputed:
        raise HTTPException(400, "По заказу открыт спор — дождитесь решения арбитража")

    task.status = TaskStatus.completed

    # Безопасная сделка: переводим замороженные (эскроу) средства исполнителю
    budget = task.budget or 0
    released = 0
    if budget > 0 and task.executor_id:
        executor = db.query(User).filter(User.id == task.executor_id).first()
        if executor:
            executor.balance += budget
            released = budget
            db.add(Transaction(
                user_id=executor.id,
                amount=budget,
                type=TransactionType.escrow_release,
                task_id=task.id
            ))

    if task.executor_id:
        payout_note = f" {budget} ₽ переведены на ваш баланс." if released else ""
        db.add(Notification(
            user_id=task.executor_id,
            type="completed",
            title="Заказ завершён!",
            text=f"Заказчик подтвердил выполнение «{task.title}».{payout_note}",
            task_id=task.id
        ))

    db.commit()
    return {
        "message": "Заказ успешно завершён" + (f", исполнителю переведено {released} ₽" if released else ""),
        "released": released
    }
