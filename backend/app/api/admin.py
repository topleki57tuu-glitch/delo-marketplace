"""Сводка по платформе для модераторов.

Раньше администратор видел только очереди (споры и заявки на верификацию)
и не мог ответить на базовые вопросы: сколько денег сейчас на платформе,
сколько мы заработали, сколько должны пользователям. Для сервиса, который
держит чужие деньги, это обязательный минимум.

Отдельно считаем обязательства: замороженный эскроу и суммы на балансах —
это то, что платформа должна людям, и оно должно биться с фактическими
остатками.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.models import (
    User, UserRole, Task, TaskStatus, Transaction, TransactionType,
    Dispute, DisputeStatus, VerificationRequest, VerificationStatus,
    WithdrawalRequest, WithdrawalStatus, Response,
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
    online_since = now - timedelta(seconds=120)

    # ------------------------------------------------------------- пользователи
    users = {
        "total": db.query(User).count(),
        "customers": db.query(User).filter(User.role == UserRole.customer).count(),
        "specialists": db.query(User).filter(User.role == UserRole.specialist).count(),
        "pro": db.query(User).filter(User.is_pro == True).count(),  # noqa: E712
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
    escrow_held = db.query(func.coalesce(func.sum(Task.budget), 0)).filter(
        Task.status.in_((TaskStatus.in_progress, TaskStatus.disputed))
    ).scalar() or 0

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
        "pro_subscriptions": db.query(User).filter(User.is_pro == True).count(),  # noqa: E712
        "credits_in_circulation": int(
            db.query(func.coalesce(func.sum(User.response_credits), 0)).scalar() or 0
        ),
    }

    return {
        "generated_at": now.isoformat(),
        "users": users,
        "tasks": tasks,
        "money": money,
        "queues": queues,
        "monetization": monetization,
    }
