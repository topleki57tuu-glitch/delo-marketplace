from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.models import (
    Dispute, DisputeStatus, Task, TaskStatus, User,
    Transaction, TransactionType, Notification
)
from app.schemas import DisputeCreate, DisputeResolve

router = APIRouter(tags=["Disputes"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

def _get_task_or_404(db: Session, task_id: int) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Заказ не найден")
    return task

def _notify(db: Session, user_id: int, ntype: str, title: str, text: str, task_id: int):
    db.add(Notification(user_id=user_id, type=ntype, title=title, text=text, task_id=task_id))

def _active_dispute(db: Session, task_id: int) -> Optional[Dispute]:
    return db.query(Dispute).filter(
        Dispute.task_id == task_id, Dispute.status == DisputeStatus.open
    ).first()

# ---------- Открыть спор (заказчик или исполнитель, пока заказ в работе) ----------
@router.post("/tasks/{task_id}/dispute")
def open_dispute(task_id: int, req: DisputeCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    task = _get_task_or_404(db, task_id)

    if user_id not in (task.customer_id, task.executor_id):
        raise HTTPException(403, "Открыть спор могут только участники сделки")
    if task.status != TaskStatus.in_progress:
        raise HTTPException(400, "Спор можно открыть только по заказу в статусе «В работе»")
    if _active_dispute(db, task_id):
        raise HTTPException(400, "По этому заказу уже есть открытый спор")
    if not req.reason.strip():
        raise HTTPException(400, "Укажите причину спора")

    dispute = Dispute(task_id=task_id, opened_by=user_id, reason=req.reason.strip())
    db.add(dispute)
    task.status = TaskStatus.disputed

    opener = db.query(User).filter(User.id == user_id).first()
    other_id = task.executor_id if user_id == task.customer_id else task.customer_id
    opener_name = (opener.name or opener.email) if opener else "Участник"
    _notify(db, other_id, "dispute", "Открыт спор по заказу",
            f"{opener_name} открыл спор по заказу «{task.title}». Средства заморожены до решения арбитража.",
            task.id)
    db.commit()
    return {"message": "Спор открыт. Средства заморожены до решения арбитража.", "dispute_id": dispute.id}

# ---------- Отмена назначения / отзыв спора ----------
@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    task = _get_task_or_404(db, task_id)

    if task.status not in (TaskStatus.open, TaskStatus.in_progress, TaskStatus.disputed):
        raise HTTPException(400, "Отменить можно только открытый заказ, заказ в работе или на арбитраже")

    dispute = _active_dispute(db, task_id)
    is_customer = user_id == task.customer_id
    is_executor = user_id == task.executor_id

    if dispute:
        # По заказу открыт спор — отмена недоступна, но инициатор может отозвать спор
        if dispute.opened_by != user_id:
            raise HTTPException(403, "По заказу открыт спор — дождитесь решения арбитража")
        dispute.status = DisputeStatus.closed
        from datetime import datetime
        dispute.resolved_at = datetime.utcnow().isoformat()
        dispute.resolution_comment = "Спор отозван инициатором, заказ отменён"
    elif not (is_customer or is_executor):
        raise HTTPException(403, "Отменить заказ могут только участники сделки")

    # Возврат эскроу заказчику. Деньги замораживаются только при назначении
    # исполнителя (assign_task списывает бюджет), поэтому у открытого заказа
    # возвращать нечего — иначе баланс пополнился бы суммой, которая не списывалась.
    budget = task.budget or 0
    refunded = 0
    if budget > 0 and task.executor_id is not None:
        customer = db.query(User).filter(User.id == task.customer_id).first()
        if customer:
            customer.balance += budget
            refunded = budget
            db.add(Transaction(
                user_id=customer.id, amount=budget,
                type=TransactionType.escrow_refund, task_id=task.id
            ))

    task.status = TaskStatus.cancelled
    cancelled_by = "заказчиком" if is_customer else ("исполнителем" if is_executor else "инициатором спора")
    refund_note = " Эскроу возвращён заказчику." if refunded else ""
    for uid in {task.customer_id, task.executor_id} - {user_id, None}:
        _notify(db, uid, "cancelled", "Заказ отменён",
                f"Заказ «{task.title}» отменён ({cancelled_by}).{refund_note}",
                task.id)
    db.commit()
    return {"message": "Заказ отменён" + (f", заказчику возвращено {refunded} ₽" if refunded else ""), "refunded": refunded}

# ---------- Информация о споре по заказу (для участников и арбитров) ----------
@router.get("/tasks/{task_id}/dispute")
def get_task_dispute(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    task = _get_task_or_404(db, task_id)
    user = db.query(User).filter(User.id == user_id).first()

    if user_id not in (task.customer_id, task.executor_id) and not is_admin(user):
        raise HTTPException(403, "Нет доступа к информации о споре")

    dispute = db.query(Dispute).filter(Dispute.task_id == task_id).order_by(Dispute.id.desc()).first()
    if not dispute:
        return {"dispute": None}

    opener = db.query(User).filter(User.id == dispute.opened_by).first()
    return {"dispute": {
        "id": dispute.id,
        "task_id": dispute.task_id,
        "opened_by": dispute.opened_by,
        "opened_by_name": (opener.name or opener.email) if opener else None,
        "reason": dispute.reason,
        "status": dispute.status.value if hasattr(dispute.status, "value") else str(dispute.status),
        "resolution_comment": dispute.resolution_comment,
        "created_at": dispute.created_at,
        "resolved_at": dispute.resolved_at,
    }}

# ---------- Арбитраж: список открытых споров ----------
@router.get("/admin/disputes")
def list_disputes(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(user):
        raise HTTPException(403, "Доступно только арбитрам платформы")

    disputes = db.query(Dispute).filter(Dispute.status == DisputeStatus.open).order_by(Dispute.id.desc()).all()
    result = []
    for d in disputes:
        task = db.query(Task).filter(Task.id == d.task_id).first()
        opener = db.query(User).filter(User.id == d.opened_by).first()
        customer = db.query(User).filter(User.id == task.customer_id).first() if task else None
        executor = db.query(User).filter(User.id == task.executor_id).first() if task and task.executor_id else None
        result.append({
            "id": d.id,
            "task_id": d.task_id,
            "task_title": task.title if task else None,
            "budget": task.budget if task else None,
            "opened_by_name": (opener.name or opener.email) if opener else None,
            "customer_name": (customer.name or customer.email) if customer else None,
            "executor_name": (executor.name or executor.email) if executor else None,
            "reason": d.reason,
            "created_at": d.created_at,
        })
    return {"disputes": result, "count": len(result)}

# ---------- Арбитраж: решение по спору ----------
@router.post("/admin/disputes/{dispute_id}/resolve")
def resolve_dispute(dispute_id: int, req: DisputeResolve, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступно только арбитрам платформы")

    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(404, "Спор не найден")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(400, "Спор уже закрыт")

    task = _get_task_or_404(db, dispute.task_id)
    budget = task.budget or 0

    from datetime import datetime
    if req.decision == "refund_customer":
        dispute.status = DisputeStatus.resolved_customer
        task.status = TaskStatus.cancelled
        if budget > 0:
            customer = db.query(User).filter(User.id == task.customer_id).first()
            if customer:
                customer.balance += budget
                db.add(Transaction(user_id=customer.id, amount=budget,
                                   type=TransactionType.escrow_refund, task_id=task.id))
        verdict = "Средства возвращены заказчику"
    elif req.decision == "pay_specialist":
        dispute.status = DisputeStatus.resolved_specialist
        task.status = TaskStatus.completed
        if budget > 0 and task.executor_id:
            executor = db.query(User).filter(User.id == task.executor_id).first()
            if executor:
                # Та же комиссия, что и при обычном завершении сделки:
                # 5% сервиса, для PRO-специалистов — 0%
                fee_percent = 0 if executor.is_pro else 5
                fee = round(budget * fee_percent / 100)
                payout = budget - fee
                executor.balance += payout
                db.add(Transaction(user_id=executor.id, amount=payout,
                                   type=TransactionType.escrow_release, task_id=task.id,
                                   fee=fee))
        verdict = "Средства выплачены исполнителю"
    else:
        raise HTTPException(400, "decision должен быть refund_customer или pay_specialist")

    dispute.resolution_comment = req.comment
    dispute.resolved_at = datetime.utcnow().isoformat()

    for uid in {task.customer_id, task.executor_id} - {None}:
        _notify(db, uid, "dispute_resolved", "Спор решён арбитражем",
                f"По заказу «{task.title}» вынесено решение: {verdict}." +
                (f" Комментарий арбитра: {req.comment}" if req.comment else ""),
                task.id)
    db.commit()
    return {"message": f"Спор закрыт: {verdict}", "decision": req.decision}
