from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.security import oauth2_scheme, decode_token
from app.core.csrf import verify_csrf
from app.core.logging import logger, log_escrow_operation
from app.models import User, Transaction, PaymentRecord, Task, Notification, UserRole, TaskStatus, TransactionType
from app.schemas import DepositRequest
from pydantic import BaseModel
import payments

router = APIRouter(tags=["Payments"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

DEMO_DEPOSIT_MAX = 100000

MONETIZATION_PACKAGES = {
    "resp_10": {"type": "responses", "title": "10 откликов", "credits": 10, "price": 190},
    "resp_50": {"type": "responses", "title": "50 откликов", "credits": 50, "price": 790},
    "pro_1": {"type": "pro", "title": "PRO на 1 месяц", "days": 30, "price": 590},
    "pro_3": {"type": "pro", "title": "PRO на 3 месяца", "days": 90, "price": 1490},
    "pro_12": {"type": "pro", "title": "PRO на год", "days": 365, "price": 4900},
}

class BuyPackageRequest(BaseModel):
    package_id: str

@router.post("/wallet/deposit")
def deposit_funds(req: DepositRequest, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    if settings.IS_PRODUCTION:
        raise HTTPException(403, "Демо-пополнение недоступно. Используйте оплату через платёжную систему.")
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if req.amount <= 0:
        raise HTTPException(400, "Сумма должна быть больше 0")
    if req.amount > DEMO_DEPOSIT_MAX:
        raise HTTPException(400, f"Слишком большая сумма (максимум {DEMO_DEPOSIT_MAX} ₽)")

    user.balance += req.amount
    tx = Transaction(user_id=user.id, amount=req.amount, type=TransactionType.deposit)
    db.add(tx)
    db.commit()
    return {"message": "Баланс пополнен", "new_balance": user.balance}

@router.get("/monetization/packages")
def get_packages():
    return {"packages": [
        {"id": pid, **pkg} for pid, pkg in MONETIZATION_PACKAGES.items()
    ]}

@router.post("/monetization/buy")
def buy_package(req: BuyPackageRequest, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    pkg = MONETIZATION_PACKAGES.get(req.package_id)
    if not pkg:
        raise HTTPException(404, "Пакет не найден")

    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if user.role != UserRole.specialist:
        raise HTTPException(403, "Пакеты доступны только специалистам")
    if (user.balance or 0) < pkg["price"]:
        raise HTTPException(400, f"Недостаточно средств: нужно {pkg['price']} ₽. Пополните баланс.")

    user.balance -= pkg["price"]
    tx = Transaction(user_id=user.id, amount=-pkg["price"], type=TransactionType.purchase)
    db.add(tx)

    if pkg["type"] == "responses":
        user.response_credits = (user.response_credits or 0) + pkg["credits"]
        msg = f"Пакет «{pkg['title']}» куплен! Откликов: {user.response_credits}"
    else:
        from datetime import timedelta
        base = datetime.utcnow()
        if user.pro_until and user.pro_until > base:
            base = user.pro_until
        user.pro_until = base + timedelta(days=pkg["days"])
        user.is_pro = True
        msg = f"PRO активирован до {user.pro_until.strftime('%Y-%m-%d')}"

    db.commit()
    return {
        "message": msg,
        "balance": user.balance,
        "response_credits": user.response_credits,
        "is_pro": user.is_pro,
        "pro_until": user.pro_until
    }

@router.get("/payments/status")
def payments_status():
    return {"configured": payments.is_configured()}

@router.post("/payments/create")
def create_payment(req: DepositRequest, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if req.amount <= 0:
        raise HTTPException(400, "Сумма должна быть больше 0")

    if not payments.is_configured():
        raise HTTPException(400, "Платёжная система не настроена. Используйте демо-пополнение.")

    result = payments.create_payment(
        amount=req.amount,
        description=f"Пополнение баланса «ДЕЛО» на {req.amount} руб.",
        metadata={"user_id": str(user_id), "amount": str(req.amount)}
    )

    if "error" in result:
        raise HTTPException(502, f"Ошибка создания платежа: {result['error']}")

    return {
        "payment_id": result["payment_id"],
        "confirmation_url": result["confirmation_url"]
    }

@router.post("/payments/confirm")
def confirm_payment(payment_id: str, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    status_result = payments.get_payment_status(payment_id)
    if "error" in status_result:
        raise HTTPException(502, f"Ошибка проверки платежа: {status_result['error']}")

    if not status_result.get("paid"):
        return {"status": status_result["status"], "credited": False}

    meta_user_id = status_result.get("metadata", {}).get("user_id")
    if meta_user_id != str(user_id):
        raise HTTPException(403, "Платёж не принадлежит этому пользователю")

    already = db.query(PaymentRecord).filter(PaymentRecord.payment_id == payment_id).first()
    if already:
        return {"status": "succeeded", "credited": False, "message": "Уже зачислено"}

    amount = status_result["amount"]
    user = db.query(User).filter(User.id == user_id).first()
    user.balance += amount
    tx = Transaction(user_id=user_id, amount=amount, type=TransactionType.deposit)
    db.add(tx)
    db.add(PaymentRecord(payment_id=payment_id, user_id=user_id, amount=amount))
    db.commit()

    return {"status": "succeeded", "credited": True, "new_balance": user.balance}

@router.put("/tasks/{task_id}/assign")
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

    spec = db.query(User).filter(User.id == specialist_id, User.role == UserRole.specialist).first()
    if not spec:
        raise HTTPException(400, "Специалист не найден")

    budget = task.budget or 0
    if customer.balance < budget:
        raise HTTPException(400, "Недостаточно средств для безопасной сделки")

    customer.balance -= budget
    if budget > 0:
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

    task.executor_id = specialist_id
    task.status = TaskStatus.in_progress
    db.commit()

    db.add(Notification(
        user_id=specialist_id,
        type="assigned",
        title="Вас выбрали исполнителем!",
        text=f"Заказчик назначил вас на задачу \"{task.title}\"",
        task_id=task.id
    ))
    db.commit()
    return {"message": "Исполнитель назначен"}
