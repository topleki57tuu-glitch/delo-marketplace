import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.encoders import jsonable_encoder
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.core.enums import enum_value
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.core.money import credit_balance, debit_balance, claim
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


# ---------------------------------------------------------------------------
# Точный адрес задания — только участникам сделки.
#
# Заказчик пишет в поле «Адрес» улицу и дом — чаще всего свои собственные.
# Раньше лента GET /tasks/ и страница GET /tasks/{id} отдавали их любому
# анонимному запросу вместе с координатами точки на карте: адрес квартиры
# и время, когда хозяин ждёт мастера, собирались одним запросом без входа.
#
# Теперь в публичной выдаче — город и координаты, округлённые до района,
# а улица, дом и точная точка — только заказчику, назначенному исполнителю
# и модераторам. Исполнителю, который решает, откликаться ли, этого хватает:
# видно город и примерное место на карте. Обещание записано в правилах
# сервиса (frontend/src/pages/legal/TermsDoc.jsx, п. 3.1).
# Регресс — tests/security/check_task_address_privacy.py.
# ---------------------------------------------------------------------------

# Два знака после запятой — около 1,1 км по широте и 0,6 км по долготе
# на широте Москвы: район, а не дом.
PUBLIC_COORD_DIGITS = 2

# Токен на странице задания необязателен: её открывают и без входа.
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)


def _approx_coord(value: Optional[float]) -> Optional[float]:
    return round(value, PUBLIC_COORD_DIGITS) if value is not None else None


def _public_task(task: Task) -> dict:
    """Задание для общей ленты: все поля, кроме точного адреса.

    Раньше лента отдавала ORM-объекты целиком, и любое новое поле модели
    само попадало в публичный ответ. Набор полей прежний — все колонки
    таблицы, — но адрес и точка теперь проходят через этот фильтр.
    """
    data = {column.name: getattr(task, column.name) for column in Task.__table__.columns}
    data["address"] = None
    data["latitude"] = _approx_coord(task.latitude)
    data["longitude"] = _approx_coord(task.longitude)
    # Фронтенд по этому флагу объясняет, почему адреса нет: он есть, но скрыт.
    data["address_hidden"] = bool(task.address)
    return data


def _sees_exact_location(task: Task, token: Optional[str], db: Session) -> bool:
    """Заказчик, назначенный исполнитель или модератор.

    Неверный или истёкший токен — 401, а не тихий переход к публичному виду:
    фронтенд на 401 продлевает сессию и повторяет запрос
    (frontend/src/utils/session.js), и исполнитель видит адрес сразу,
    а не после перезагрузки страницы.
    """
    if not token:
        return False
    payload = decode_token(token)
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return False
    if user_id == task.customer_id or (task.executor_id is not None and user_id == task.executor_id):
        return True
    viewer = db.query(User).filter(User.id == user_id).first()
    return viewer is not None and is_admin(viewer)

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

TASKS_LIST_MAX = 200

# Ключ кэша ленты без фильтров. Версия в имени — формат выдачи: под прежним
# ключом (tasks:list:open:all) лежала выдача с точным адресом, и после
# обновления она отдавалась бы из кэша ещё минуту.
TASKS_LIST_CACHE_KEY = "tasks:list:open:v2"


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
        cache_key = TASKS_LIST_CACHE_KEY
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
            "tasks": [_public_task(t) for t in tasks],
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page,
        }

    # Без page — не больше TASKS_LIST_MAX записей. Раньше здесь отдавалась вся
    # таблица (в том числе Telegram-боту каждую секунду), и с ростом базы
    # каждый заход на главную тянул бы тысячи строк.
    result = [_public_task(t) for t in query.limit(TASKS_LIST_MAX).all()]

    # Сохраняем в кеш если это кешируемый запрос
    #
    # jsonable_encoder обязателен: в словарях `result` остаются перечисления
    # (category, status) и datetime. Раньше здесь были ORM-объекты Task, и
    # `json.dumps(..., default=str)` превращал каждый в строку вида
    # "<app.models.Task object at 0x...>": первый запрос (промах кэша) отдавал
    # нормальный список, а все последующие в течение 60 секунд — такие строки.
    if is_cacheable and cache.enabled:
        try:
            cache.set(cache_key, json.dumps(jsonable_encoder(result)), ttl_seconds=60)
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

    Оптимизация: контрагентов подтягиваем одним запросом по собранным заранее
    id, а отклики считаем подзапросом — обе части без N+1.

    Раньше здесь стоял `joinedload(Task.customer/executor)`, но связанных
    объектов у `Task` нет вовсе: в модели объявлены только `customer_id` и
    `executor_id`, ни одного `relationship()`. Обращение к несуществующему
    атрибуту падало с `AttributeError: type object 'Task' has no attribute
    'executor'` на построении запроса, то есть ДО обращения к базе, — и роут
    отвечал 500 на любой запрос, независимо от данных. Ни один набор его не
    вызывал, поэтому дефект дожил до аудита: страница «Мои задания»
    (MyTasksPage.jsx:49, tasksStore.js:70) была нерабочей целиком.
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

    # Основной запрос: счётчик откликов приезжает подзапросом, отдельного
    # запроса на каждый заказ не нужно.
    query = (
        db.query(Task)
        .outerjoin(responses_subq, Task.id == responses_subq.c.task_id)
        .add_columns(func.coalesce(responses_subq.c.count, 0).label('responses_count'))
    )

    # Связанных объектов у Task нет — только customer_id и executor_id, —
    # поэтому фильтруем по колонке, а контрагента подтягиваем ниже.
    if role == "customer":
        query = query.filter(Task.customer_id == user_id)
    else:
        query = query.filter(Task.executor_id == user_id)

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

    # Контрагент для каждой строки: заказчик видит исполнителя и наоборот.
    # Один запрос на весь список, а не по запросу на строку.
    counterparty_ids = {
        (t.executor_id if role == "customer" else t.customer_id) for t, _ in results
    }
    counterparty_ids.discard(None)
    counterparties = (
        {u.id: u for u in db.query(User).filter(User.id.in_(counterparty_ids)).all()}
        if counterparty_ids else {}
    )

    result = []
    for t, responses_count in results:
        counterparty = counterparties.get(
            t.executor_id if role == "customer" else t.customer_id
        )
        result.append({
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "budget": t.budget,
            "category": enum_value(t.category),
            "status": enum_value(t.status),
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
def get_task_detail(
    task_id: int,
    token: Optional[str] = Depends(optional_oauth2_scheme),
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")
    exact = _sees_exact_location(task, token, db)
    customer = db.query(User).filter(User.id == task.customer_id).first()
    responses_count = db.query(Response).filter(Response.task_id == task_id).count()
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "budget": task.budget,
        "category": enum_value(task.category),
        "customer_id": task.customer_id,
        "customer_name": customer.name if customer else None,
        "customer_avatar": customer.avatar if customer else None,
        "executor_id": task.executor_id,
        "status": enum_value(task.status),
        "has_open_dispute": db.query(Dispute).filter(
            Dispute.task_id == task_id, Dispute.status == DisputeStatus.open
        ).first() is not None,
        "city": task.city,
        "address": task.address if exact else None,
        "latitude": task.latitude if exact else _approx_coord(task.latitude),
        "longitude": task.longitude if exact else _approx_coord(task.longitude),
        "address_hidden": bool(task.address) and not exact,
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

# Назначение исполнителя: бюджет заказа замораживается на балансе заказчика
# (эскроу) и уходит исполнителю при завершении — PUT /tasks/{task_id}/complete.
@router.put("/{task_id}/assign")
def assign_task(task_id: int, specialist_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    customer_id = int(payload.get("sub"))

    # Блокируем заказчика и заказ для защиты от race condition
    # (двойное назначение или назначение при недостаточном балансе после его изменения)
    customer = db.query(User).filter(User.id == customer_id).with_for_update().first()
    task = db.query(Task).filter(Task.id == task_id, Task.customer_id == customer_id).with_for_update().first()
    if not task:
        raise HTTPException(404, "Заказ не найден или вы не его автор")
    if task.status != TaskStatus.open:
        raise HTTPException(400, "Назначить исполнителя можно только для открытого заказа")

    # Сам себе исполнитель. Роль переключается в профиле (/users/me/switch-role),
    # поэтому заказчик мог стать «специалистом» и назначить на свой заказ
    # самого себя — затем завершить сделку и оставить себе отзыв (накрутка
    # рейтинга), а с комиссией — ещё и гонять деньги по кругу.
    if specialist_id == customer_id:
        raise HTTPException(400, "Нельзя назначить исполнителем самого себя")

    spec = db.query(User).filter(User.id == specialist_id, User.role == UserRole.specialist).first()
    if not spec:
        raise HTTPException(400, "Специалист не найден")

    # Заказ «забирается» условным UPDATE до списания денег. Иначе два
    # одновременных назначения (двойной клик) оба проходили проверку статуса
    # выше и замораживали бюджет дважды, а вернуть при отмене можно только раз.
    if not claim(db, Task, [Task.id == task.id, Task.status == TaskStatus.open],
                 {"status": TaskStatus.in_progress, "executor_id": specialist_id}):
        db.rollback()
        raise HTTPException(409, "Исполнитель уже назначен")

    budget = task.budget or 0
    if budget > 0:
        # Заморозка эскроу атомарная: проверка баланса входит в сам UPDATE
        # (см. app/core/money.py).
        if not debit_balance(db, customer_id, budget):
            db.rollback()
            raise HTTPException(400, "Недостаточно средств для безопасной сделки")
        tx = Transaction(user_id=customer.id, amount=-budget, type=TransactionType.escrow_hold, task_id=task.id)
        db.add(tx)

        # Логируем холд эскроу
        log_escrow_operation(
            operation="escrow_hold",
            task_id=task.id,
            user_id=customer.id,
            amount=budget,
            specialist_id=specialist_id
        )

    db.commit()

    # Инвалидация кеша при назначении исполнителя
    cache.invalidate_pattern("tasks:list:*")

    db.add(Notification(
        user_id=specialist_id,
        type="assigned",
        title="Вас выбрали исполнителем!",
        text=f"Заказчик назначил вас на задачу \"{task.title}\"",
        task_id=task.id
    ))
    db.commit()
    return {"message": "Исполнитель назначен"}


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

    # Переход in_progress -> completed условным UPDATE (money.claim).
    # `with_for_update()` выше на SQLite игнорируется, и одновременные
    # «завершить» и «отменить»/«открыть спор» давали и выплату исполнителю,
    # и возврат заказчику. Здесь выигрывает ровно один запрос.
    if not claim(db, Task, [Task.id == task.id, Task.status == TaskStatus.in_progress],
                 {"status": TaskStatus.completed}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")

    # Безопасная сделка (эскроу): переводим средства исполнителю с учётом комиссии платформы
    budget = task.budget or 0
    payout = 0
    fee = 0
    if budget > 0:
        executor = db.query(User).filter(User.id == task.executor_id).first()
        if executor:
            # Монетизация: 0% комиссия для действующей подписки PRO, иначе 5%.
            # Считаем по is_pro_active (флаг И срок), а не по колонке: флаг
            # снимает задача по расписанию, то есть с задержкой до суток.
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
