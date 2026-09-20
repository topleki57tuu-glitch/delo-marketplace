"""Сводка по платформе для модераторов.

Раньше администратор видел только очереди (споры и заявки на верификацию)
и не мог ответить на базовые вопросы: сколько денег сейчас на платформе,
сколько мы заработали, сколько должны пользователям. Для сервиса, который
держит чужие деньги, это обязательный минимум.

Отдельно считаем обязательства: замороженный эскроу и суммы на балансах —
это то, что платформа должна людям, и оно должно биться с фактическими
остатками.

Admin Dashboard: расширен для полноценного дашборда с графиками, списками
пользователей и активности.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.presence import ONLINE_WINDOW_SECONDS
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.models import (
    User, UserRole, Task, TaskStatus, Transaction, TransactionType,
    Dispute, DisputeStatus, VerificationRequest, VerificationStatus,
    WithdrawalRequest, WithdrawalStatus, Response,
    Order, OrderStatus, Product,
)

router = APIRouter(tags=["Admin"])


def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


@router.get("/admin/stats")
def platform_stats(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")

    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    # Окно берём из общего модуля: если оно разъедется с тем, что считает
    # app/core/presence.py, счётчик в админке и бейджи «Онлайн» в интерфейсе
    # начнут показывать разное по одним и тем же данным.
    online_since = now - timedelta(seconds=ONLINE_WINDOW_SECONDS)

    # ------------------------------------------------------------- пользователи
    users = {
        "total": db.query(User).count(),
        "customers": db.query(User).filter(User.role == UserRole.customer).count(),
        "specialists": db.query(User).filter(User.role == UserRole.specialist).count(),
        # Действующие подписки (флаг И неистёкший срок), а не число когда-либо
        # оформленных: celery-задача, которая снимала бы флаг, не запускается
        # нигде, поэтому по колонке счётчик только рос бы и никогда не падал.
        "pro": db.query(User).filter(
            User.is_pro == True,  # noqa: E712
            User.pro_until != None,  # noqa: E711
            User.pro_until > datetime.utcnow(),
        ).count(),
        "verified": db.query(User).filter(User.verified == True).count(),  # noqa: E712
        "online": db.query(User).filter(User.last_seen >= online_since).count(),
        "new_7d": db.query(User).filter(User.created_at >= week_ago).count(),
    }

    # ------------------------------------------------------------------- заказы
    tasks = {
        "total": db.query(Task).count(),
        "new_7d": db.query(Task).filter(Task.created_at >= week_ago).count(),
    }
    for st in TaskStatus:
        tasks[st.value] = db.query(Task).filter(Task.status == st).count()

    # -------------------------------------------------------------------- деньги
    # Оборот: сумма бюджетов завершённых сделок
    gmv = db.query(func.coalesce(func.sum(Task.budget), 0)).filter(
        Task.status == TaskStatus.completed
    ).scalar() or 0

    # Заработано на комиссии: удержания в выплатах исполнителям
    commission = db.query(func.coalesce(func.sum(Transaction.fee), 0)).filter(
        Transaction.type == TransactionType.escrow_release
    ).scalar() or 0

    # Заморожено в эскроу — деньги, которые платформа держит по активным сделкам
    escrow_tasks = db.query(func.coalesce(func.sum(Task.budget), 0)).filter(
        Task.status.in_((TaskStatus.in_progress, TaskStatus.disputed))
    ).scalar() or 0

    # Товарные заказы держат деньги покупателя с момента оформления до
    # подтверждения получения. Раньше они в обязательства не попадали вовсе —
    # платформа недооценивала сумму, которую должна людям, а деньги при этом
    # уже были списаны с балансов.
    escrow_orders = db.query(func.coalesce(func.sum(Order.total_price), 0)).filter(
        Order.status.in_(
            (OrderStatus.pending, OrderStatus.confirmed, OrderStatus.shipped,
             OrderStatus.delivered, OrderStatus.disputed)
        )
    ).scalar() or 0

    escrow_held = int(escrow_tasks) + int(escrow_orders)

    # Обязательства перед пользователями: суммы на балансах
    balances = db.query(func.coalesce(func.sum(User.balance), 0)).scalar() or 0

    pending_withdrawals = db.query(WithdrawalRequest).filter(
        WithdrawalRequest.status == WithdrawalStatus.pending
    ).all()
    withdrawals_pending_amount = sum(w.amount or 0 for w in pending_withdrawals)

    money = {
        "gmv": int(gmv),
        "commission_earned": int(commission),
        "escrow_held": int(escrow_held),
        "escrow_held_tasks": int(escrow_tasks),
        "escrow_held_orders": int(escrow_orders),
        "user_balances": int(balances),
        # Сколько денег платформа обязана людям прямо сейчас
        "total_liabilities": int(escrow_held) + int(balances) + int(withdrawals_pending_amount),
        "withdrawals_pending_amount": int(withdrawals_pending_amount),
        "withdrawals_paid_total": int(
            db.query(func.coalesce(func.sum(WithdrawalRequest.amount), 0)).filter(
                WithdrawalRequest.status == WithdrawalStatus.paid
            ).scalar() or 0
        ),
    }

    # -------------------------------------------------------------------- очереди
    queues = {
        "disputes_open": db.query(Dispute).filter(Dispute.status == DisputeStatus.open).count(),
        "verifications_pending": db.query(VerificationRequest).filter(
            VerificationRequest.status == VerificationStatus.pending
        ).count(),
        "withdrawals_pending": len(pending_withdrawals),
    }

    # --------------------------------------------------------------- монетизация
    monetization = {
        "responses_total": db.query(Response).count(),
        # Действующие подписки — та же логика, что в сводке по пользователям
        "pro_subscriptions": db.query(User).filter(
            User.is_pro == True,  # noqa: E712
            User.pro_until != None,  # noqa: E711
            User.pro_until > datetime.utcnow(),
        ).count(),
        "credits_in_circulation": int(
            db.query(func.coalesce(func.sum(User.response_credits), 0)).scalar() or 0
        ),
    }

    # --------------------------------------------------------------- графики для дашборда
    # Рост пользователей за 7 дней (по дням)
    users_growth_7d = []
    for i in range(7):
        day_start = (now - timedelta(days=i+1)).replace(hour=0, minute=0, second=0)
        day_end = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0)
        count = db.query(User).filter(
            User.created_at >= day_start,
            User.created_at < day_end
        ).count()
        users_growth_7d.insert(0, {"date": day_start.date().isoformat(), "count": count})

    # Задачи по категориям
    from app.models import TaskCategory
    tasks_by_category = {}
    for cat in TaskCategory:
        tasks_by_category[cat.value] = db.query(Task).filter(Task.category == cat).count()

    # Доход по дням (комиссия за последние 7 дней)
    revenue_7d = []
    for i in range(7):
        day_start = (now - timedelta(days=i+1)).replace(hour=0, minute=0, second=0)
        day_end = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0)
        revenue = db.query(func.coalesce(func.sum(Transaction.fee), 0)).filter(
            Transaction.type == TransactionType.escrow_release,
            Transaction.created_at >= day_start,
            Transaction.created_at < day_end
        ).scalar() or 0
        revenue_7d.insert(0, {"date": day_start.date().isoformat(), "revenue": int(revenue)})

    return {
        "generated_at": now.isoformat(),
        "users": users,
        "tasks": tasks,
        "money": money,
        "queues": queues,
        "monetization": monetization,
        "charts": {
            "users_growth_7d": users_growth_7d,
            "tasks_by_category": tasks_by_category,
            "revenue_7d": revenue_7d,
        }
    }


@router.get("/admin/recent-activity")
def recent_activity(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Последняя активность на платформе для дашборда.

    Возвращает последние события:
    - Новые пользователи (10 последних)
    - Новые задачи (10 последних)
    - Крупные транзакции >= 5000₽ (10 последних)
    """
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")

    # Последние пользователи
    recent_users = db.query(User).order_by(User.created_at.desc()).limit(10).all()

    # Последние задачи
    recent_tasks = db.query(Task).order_by(Task.created_at.desc()).limit(10).all()

    # Последние крупные транзакции (>= 5000₽)
    recent_transactions = db.query(Transaction).filter(
        Transaction.amount >= 5000
    ).order_by(Transaction.created_at.desc()).limit(10).all()

    return {
        "users": [{
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role.value,
            "created_at": u.created_at.isoformat() if u.created_at else None
        } for u in recent_users],
        "tasks": [{
            "id": t.id,
            "title": t.title,
            "budget": t.budget,
            "status": t.status.value,
            "category": t.category.value,
            "customer_id": t.customer_id,
            "created_at": t.created_at.isoformat() if t.created_at else None
        } for t in recent_tasks],
        "transactions": [{
            "id": tr.id,
            "amount": tr.amount,
            "fee": tr.fee,
            "type": tr.type.value,
            "user_id": tr.user_id,
            "task_id": tr.task_id,
            "created_at": tr.created_at.isoformat() if tr.created_at else None
        } for tr in recent_transactions],
    }


@router.get("/admin/users")
def list_users(
    role: Optional[str] = None,
    verified: Optional[bool] = None,
    is_pro: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Список пользователей с фильтрацией для админа.

    Параметры:
    - role: customer | specialist
    - verified: true | false
    - is_pro: true | false — ДЕЙСТВУЮЩАЯ подписка (флаг и неистёкший срок)
    - search: поиск по email и имени
    - page: номер страницы (default 1)
    - per_page: записей на страницу (default 20, max 100)
    """
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступ разрешён только модераторам сервиса")

    # Ограничение per_page
    per_page = min(per_page, 100)

    query = db.query(User)

    # Фильтры
    if role:
        try:
            role_enum = UserRole(role)
            query = query.filter(User.role == role_enum)
        except ValueError:
            pass

    if verified is not None:
        query = query.filter(User.verified == verified)

    if is_pro is not None:
        # По сроку, а не по колонке: иначе фильтр «PRO» показывал бы в том
        # числе тех, у кого подписка давно истекла (флаг никто не снимает).
        active = [
            User.is_pro == True,  # noqa: E712
            User.pro_until != None,  # noqa: E711
            User.pro_until > datetime.utcnow(),
        ]
        query = query.filter(*active) if is_pro else query.filter(~sa.and_(*active))

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (User.email.ilike(search_pattern)) | (User.name.ilike(search_pattern))
        )

    # Подсчет и пагинация
    total = query.count()
    users = query.order_by(User.created_at.desc()).offset((page-1)*per_page).limit(per_page).all()

    return {
        "users": [{
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role.value,
            "balance": u.balance or 0,
            "verified": u.verified,
            # Действующая подписка — чтобы админ не принял истёкшую за живую
            "is_pro": u.is_pro_active,
            "pro_until": u.pro_until.isoformat() if u.pro_until else None,
            "city": u.city,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_seen": u.last_seen.isoformat() if u.last_seen else None
        } for u in users],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }
