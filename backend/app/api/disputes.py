from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.core.money import credit_balance
from app.core.csrf import verify_csrf
from app.core.logging import logger, log_escrow_operation
from app.models import (
    Dispute, DisputeStatus, Task, TaskStatus, User,
    Transaction, TransactionType, Notification,
    Order, OrderStatus, Product,
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
def open_dispute(task_id: int, req: DisputeCreate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
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
def cancel_task(task_id: int, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # Блокируем заказ для предотвращения race condition с завершением
    task = db.query(Task).filter(Task.id == task_id).with_for_update().first()
    if not task:
        raise HTTPException(404, "Заказ не найден")

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
        dispute.resolved_at = datetime.utcnow()
        dispute.resolution_comment = "Спор отозван инициатором, заказ отменён"
    elif not (is_customer or is_executor):
        raise HTTPException(403, "Отменить заказ могут только участники сделки")

    # Возврат эскроу заказчику. Деньги замораживаются только при назначении
    # исполнителя (assign_task списывает бюджет), поэтому у открытого заказа
    # возвращать нечего — иначе баланс пополнился бы суммой, которая не списывалась.
    budget = task.budget or 0
    refunded = 0
    if budget > 0 and task.executor_id is not None:
        # Начисление атомарным UPDATE (см. app/core/money.py)
        customer = db.query(User).filter(User.id == task.customer_id).first()
        if customer:
            credit_balance(db, customer.id, budget)
            refunded = budget
            db.add(Transaction(
                user_id=customer.id, amount=budget,
                type=TransactionType.escrow_refund, task_id=task.id
            ))

            # Логируем возврат эскроу
            log_escrow_operation(
                operation="escrow_refund_cancel",
                task_id=task.id,
                user_id=customer.id,
                amount=budget,
                cancelled_by=user_id
            )

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
        opener = db.query(User).filter(User.id == d.opened_by).first()
        opened_by_name = (opener.name or opener.email) if opener else None

        if d.order_id:
            # Спор по заказу товара: покупатель ↔ продавец
            order = db.query(Order).filter(Order.id == d.order_id).first()
            product = db.query(Product).filter(Product.id == order.product_id).first() if order else None
            buyer = db.query(User).filter(User.id == order.buyer_id).first() if order else None
            seller = db.query(User).filter(User.id == order.seller_id).first() if order else None
            result.append({
                "id": d.id,
                "kind": "order",
                "order_id": d.order_id,
                "task_id": None,
                # title/amount — общие имена для обоих видов спора, чтобы
                # интерфейс арбитра не различал их при отрисовке
                "title": product.title if product else None,
                "amount": order.total_price if order else None,
                "opened_by_name": opened_by_name,
                "customer_name": (buyer.name or buyer.email) if buyer else None,
                "executor_name": (seller.name or seller.email) if seller else None,
                "reason": d.reason,
                "created_at": d.created_at,
            })
            continue

        task = db.query(Task).filter(Task.id == d.task_id).first()
        customer = db.query(User).filter(User.id == task.customer_id).first() if task else None
        executor = db.query(User).filter(User.id == task.executor_id).first() if task and task.executor_id else None
        result.append({
            "id": d.id,
            "kind": "task",
            "task_id": d.task_id,
            "order_id": None,
            "title": task.title if task else None,
            "amount": task.budget if task else None,
            "opened_by_name": opened_by_name,
            "customer_name": (customer.name or customer.email) if customer else None,
            "executor_name": (executor.name or executor.email) if executor else None,
            "reason": d.reason,
            "created_at": d.created_at,
        })
    return {"disputes": result, "count": len(result)}

def _resolve_order_dispute(db: Session, dispute: Dispute, req, admin) -> dict:
    """Решение арбитра по спору о заказе товара.

    Деньги те же, что и в обычном исходе заказа: возврат покупателю либо
    выплата продавцу за вычетом комиссии, которая уже посчитана при создании
    заказа (`order.platform_fee` — 0% для PRO).
    """
    from datetime import datetime

    order = db.query(Order).filter(Order.id == dispute.order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status != OrderStatus.disputed:
        raise HTTPException(400, "Заказ не находится в статусе спора")

    amount = order.total_price or 0

    if req.decision == "refund_customer":
        dispute.status = DisputeStatus.resolved_customer
        order.status = OrderStatus.cancelled
        if amount > 0:
            credit_balance(db, order.buyer_id, amount)
            db.add(Transaction(user_id=order.buyer_id, amount=amount,
                               type=TransactionType.escrow_refund, task_id=None, fee=0))
            log_escrow_operation(
                operation="order_escrow_refund_arbitration",
                task_id=order.id,
                user_id=order.buyer_id,
                amount=amount,
                dispute_id=dispute.id,
                arbiter_id=admin.id,
            )
        # Товар возвращается в продажу — как при обычной отмене
        db.query(Product).filter(Product.id == order.product_id).update(
            {"stock": Product.stock + order.quantity}, synchronize_session=False
        )
        db.query(Product).filter(
            Product.id == order.product_id, Product.status == "sold_out"
        ).update({"status": "active"}, synchronize_session=False)
        verdict = "Средства возвращены покупателю"
    elif req.decision == "pay_specialist":
        dispute.status = DisputeStatus.resolved_specialist
        order.status = OrderStatus.completed
        fee = order.platform_fee or 0
        payout = amount - fee
        if payout > 0:
            credit_balance(db, order.seller_id, payout)
            db.add(Transaction(user_id=order.seller_id, amount=payout,
                               type=TransactionType.escrow_release, task_id=None, fee=fee))
            log_escrow_operation(
                operation="order_escrow_release_arbitration",
                task_id=order.id,
                user_id=order.seller_id,
                amount=payout,
                fee=fee,
                dispute_id=dispute.id,
                arbiter_id=admin.id,
            )
        verdict = "Средства выплачены продавцу"
    else:
        raise HTTPException(400, "decision должен быть refund_customer или pay_specialist")

    dispute.resolution_comment = req.comment
    dispute.resolved_at = datetime.utcnow()

    for uid in {order.buyer_id, order.seller_id} - {None}:
        _notify(db, uid, "dispute_resolved", "Спор решён арбитражем",
                f"По заказу #{order.id} вынесено решение: {verdict}." +
                (f" Комментарий арбитра: {req.comment}" if req.comment else ""),
                None)
    db.commit()
    return {"message": f"Спор закрыт: {verdict}", "decision": req.decision}


# ---------- Арбитраж: решение по спору ----------
@router.post("/admin/disputes/{dispute_id}/resolve")
def resolve_dispute(dispute_id: int, req: DisputeResolve, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    admin = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not is_admin(admin):
        raise HTTPException(403, "Доступно только арбитрам платформы")

    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(404, "Спор не найден")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(400, "Спор уже закрыт")

    # Одна очередь арбитра на два вида сделок: задание или заказ товара
    if dispute.order_id:
        return _resolve_order_dispute(db, dispute, req, admin)

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

                # Логируем арбитражное решение - возврат заказчику
                log_escrow_operation(
                    operation="escrow_refund_arbitration",
                    task_id=task.id,
                    user_id=customer.id,
                    amount=budget,
                    dispute_id=dispute.id,
                    arbiter_id=admin.id
                )
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

                # Логируем арбитражное решение - выплата исполнителю
                log_escrow_operation(
                    operation="escrow_release_arbitration",
                    task_id=task.id,
                    user_id=executor.id,
                    amount=payout,
                    fee=fee,
                    dispute_id=dispute.id,
                    arbiter_id=admin.id
                )
        verdict = "Средства выплачены исполнителю"
    else:
        raise HTTPException(400, "decision должен быть refund_customer или pay_specialist")

    dispute.resolution_comment = req.comment
    dispute.resolved_at = datetime.utcnow()

    for uid in {task.customer_id, task.executor_id} - {None}:
        _notify(db, uid, "dispute_resolved", "Спор решён арбитражем",
                f"По заказу «{task.title}» вынесено решение: {verdict}." +
                (f" Комментарий арбитра: {req.comment}" if req.comment else ""),
                task.id)
    db.commit()
    return {"message": f"Спор закрыт: {verdict}", "decision": req.decision}
