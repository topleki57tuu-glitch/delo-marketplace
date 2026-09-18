import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.core.money import credit_balance
from app.core.csrf import verify_csrf
from app.core.logging import logger, log_escrow_operation
from app.core.cache import cache
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
def create_task(task: TaskCreate, request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    # FIX: Добавлен rate limiting для защиты от спама
    from app.core.security import rate_limit
    rate_limit(request, "create_task", limit=10, window_sec=300)

    payload = decode_token_or_401(token)
    # Роль берём из БД, а не из JWT: в токене роль остаётся прежней до 7 дней
    # после переключения роли
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user or user.role != UserRole.customer:
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

    # Инвалидация кеша списка задач
    cache.invalidate_pattern("tasks:list:*")

    return {"message": "Задание создано", "task_id": new_task.id}

@router.get("/")
def get_tasks(
    category: Optional[TaskCategory] = None,
    search: Optional[str] = None,
    city: Optional[str] = None,
    is_remote: Optional[bool] = None,
    status_filter: Optional[str] = None,
    page: Optional[int] = None,
    per_page: int = 20,
    db: Session = Depends(get_db)
):
    """Список задач с опциональными фильтрами и пагинацией.

    Оптимизация: открытые задачи без фильтров кешируются в Redis на 60 секунд,
    снижая нагрузку на БД при частых обращениях на главную страницу.
    """
    # Проверяем возможность кеширования (только для открытых задач без фильтров)
    is_cacheable = (
        not category and not search and not city and
        is_remote is None and not status_filter and not page
    )

    if is_cacheable:
        cache_key = "tasks:list:open:all"
        cached = cache.get(cache_key)
        if cached:
            try:
                logger.debug(f"Cache HIT: {cache_key}")
                return json.loads(cached)
            except json.JSONDecodeError:
                logger.warning(f"Cache decode error for {cache_key}")

    # Кеш промах или некешируемый запрос - выполняем запрос к БД
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

    query = query.order_by(Task.id.desc())

    # Опциональная пагинация: с параметром page возвращается объект с метаданными,
    # без него — прежний полный список (обратная совместимость фронта/тестов)
    if page is not None:
        page = max(1, page)
        per_page = min(max(1, per_page), 50)
        total = query.count()
        tasks = query.offset((page - 1) * per_page).limit(per_page).all()
        return {
            "tasks": tasks,
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page,
        }

    result = query.all()

    # Сохраняем в кеш если это кешируемый запрос
    if is_cacheable and cache.enabled:
        try:
            cache.set(cache_key, json.dumps(result, default=str), ttl_seconds=60)
            logger.debug(f"Cache SET: {cache_key}")
        except (TypeError, ValueError) as e:
            logger.warning(f"Cache serialization error: {e}")

    return result

@router.get("/my")
def get_my_tasks(
    role: str = "customer",
    status_filter: Optional[str] = None,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Заказы текущего пользователя — где он заказчик или где он исполнитель.

    Раньше своих заказов посмотреть было негде: они растворялись в общем
    списке, и после публикации заказчик терял его из виду.

    ВАЖНО: этот маршрут объявлен ДО `/{task_id}`, иначе FastAPI попытался бы
    разобрать «my» как целочисленный id и вернул бы 422.

    Оптимизация: использует joinedload для предзагрузки связанных данных
    и подзапрос для подсчета откликов, избегая N+1 проблемы.
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    if role not in ("customer", "executor"):
        raise HTTPException(400, "role должен быть customer или executor")

    # Подзапрос для подсчета откликов (избегаем N+1)
    responses_subq = (
        db.query(Response.task_id, func.count(Response.id).label('count'))
        .group_by(Response.task_id)
        .subquery()
    )

    # Основной запрос с joinedload для customer/executor
    query = (
        db.query(Task)
        .outerjoin(responses_subq, Task.id == responses_subq.c.task_id)
        .add_columns(func.coalesce(responses_subq.c.count, 0).label('responses_count'))
    )

    # Предзагрузка связанных пользователей
    if role == "customer":
        query = query.filter(Task.customer_id == user_id).options(joinedload(Task.executor))
    else:
        query = query.filter(Task.executor_id == user_id).options(joinedload(Task.customer))

    if status_filter == "active":
        query = query.filter(Task.status.in_(
            (TaskStatus.open, TaskStatus.in_progress, TaskStatus.disputed)
        ))
    elif status_filter == "completed":
        query = query.filter(Task.status == TaskStatus.completed)
    elif status_filter:
        try:
            query = query.filter(Task.status == TaskStatus(status_filter))
        except ValueError:
            raise HTTPException(400, "Неизвестный статус заказа")

    results = query.order_by(Task.id.desc()).all()

    result = []
    for t, responses_count in results:
        # Используем уже загруженные данные (без дополнительных запросов)
        counterparty = t.executor if role == "customer" else t.customer
        result.append({
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "budget": t.budget,
            "category": t.category.value if hasattr(t.category, "value") else str(t.category),
            "status": t.status.value if hasattr(t.status, "value") else str(t.status),
            "city": t.city,
            "is_remote": t.is_remote,
            "deadline": t.deadline,
            "created_at": t.created_at,
            "customer_id": t.customer_id,
            "executor_id": t.executor_id,
            "responses_count": responses_count,
            "counterparty_id": counterparty.id if counterparty else None,
            "counterparty_name": (
                (counterparty.name or counterparty.email) if counterparty else None
            ),
        })
    return result

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
def delete_task_images(task_id: int, req: TaskImagesDeleteRequest, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
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
def complete_task(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # Блокируем запись заказа для предотвращения race condition
    # (одновременное завершение и отмена). SELECT FOR UPDATE гарантирует,
    # что только одна транзакция изменит статус.
    task = db.query(Task).filter(Task.id == task_id).with_for_update().first()
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
    # Завершать нечего, если исполнитель так и не был назначен: раньше заказ молча
    # уходил в «completed» с выплатой 0 и без уведомлений. Такой заказ нужно отменять.
    if not task.executor_id:
        raise HTTPException(400, "Нельзя завершить заказ без исполнителя — отмените его, если он больше не нужен")

    task.status = TaskStatus.completed

    # Безопасная сделка (эскроу): переводим средства исполнителю с учётом комиссии платформы
    budget = task.budget or 0
    payout = 0
    fee = 0
    if budget > 0:
        executor = db.query(User).filter(User.id == task.executor_id).first()
        if executor:
            # Монетизация: 0% комиссия для действующей подписки PRO, иначе 5%.
            # Считаем по is_pro_active (флаг И срок), а не по колонке: снять
            # флаг должна была celery-задача, которой никто не запускает.
            is_pro = bool(executor.is_pro_active)
            fee_percent = 0 if is_pro else 5
            fee = round(budget * fee_percent / 100)
            payout = budget - fee

            # Начисление атомарное: инкремент в Python потерялся бы при
            # конкурентной записи баланса (см. app/core/money.py).
            credit_balance(db, executor.id, payout)
            db.add(Transaction(
                user_id=executor.id,
                amount=payout,
                type=TransactionType.escrow_release,
                task_id=task.id,
                fee=fee
            ))

            # Логируем критичную операцию выплаты эскроу
            log_escrow_operation(
                operation="escrow_release",
                task_id=task.id,
                user_id=executor.id,
                amount=payout,
                fee=fee,
                is_pro=is_pro
            )

    if payout > 0:
        if fee > 0:
            payout_note = f" {payout} ₽ переведены на ваш баланс (комиссия платформы 5%: {fee} ₽. С подпиской PRO комиссия 0%!)."
        else:
            payout_note = f" {payout} ₽ переведены на ваш баланс (0% комиссия для PRO-специалиста!)."
    else:
        payout_note = ""

    db.add(Notification(
        user_id=task.executor_id,
        type="completed",
        title="Заказ завершён!",
        text=f"Заказчик подтвердил выполнение «{task.title}».{payout_note}",
        task_id=task.id
    ))

    db.commit()

    # Инвалидация кеша при изменении статуса задачи
    cache.invalidate_pattern("tasks:list:*")

    return {
        "message": "Заказ успешно завершён" + (f", исполнителю выплачено {payout} ₽" if payout else ""),
        "released": payout,
        "fee": fee,
        "is_pro_exempt": fee == 0 and budget > 0
    }
