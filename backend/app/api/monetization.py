"""Платные возможности для специалистов: пакеты откликов и подписка PRO.

Покупаются с внутреннего баланса; пополнение баланса — в app/api/payments.py.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.core.money import debit_balance
from app.core.csrf import verify_csrf
from app.models import User, Transaction, TransactionType, UserRole
from pydantic import BaseModel

router = APIRouter(tags=["Payments"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


MONETIZATION_PACKAGES = {
    "resp_10": {"type": "responses", "title": "10 откликов", "credits": 10, "price": 190},
    "resp_50": {"type": "responses", "title": "50 откликов", "credits": 50, "price": 790},
    "pro_1": {"type": "pro", "title": "PRO на 1 месяц", "days": 30, "price": 590},
    "pro_3": {"type": "pro", "title": "PRO на 3 месяца", "days": 90, "price": 1490},
    "pro_12": {"type": "pro", "title": "PRO на год", "days": 365, "price": 4900},
}

class BuyPackageRequest(BaseModel):
    package_id: str


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

    # Списание атомарное: две одновременные покупки иначе обе прошли бы
    # проверку баланса и увели его в минус.
    if not debit_balance(db, user.id, pkg["price"]):
        db.rollback()
        raise HTTPException(400, f"Недостаточно средств: нужно {pkg['price']} ₽. Пополните баланс.")
    tx = Transaction(user_id=user.id, amount=-pkg["price"], type=TransactionType.purchase)
    db.add(tx)

    if pkg["type"] == "responses":
        # Начисление кредитов тоже атомарным UPDATE, чтобы не потерять
        # их при параллельной покупке.
        db.query(User).filter(User.id == user.id).update(
            {"response_credits": func.coalesce(User.response_credits, 0) + pkg["credits"]},
            synchronize_session=False,
        )
        db.commit()
        db.refresh(user)
        msg = f"Пакет «{pkg['title']}» куплен! Откликов: {user.response_credits}"
    else:
        from datetime import timedelta
        base = datetime.utcnow()
        if user.pro_until and user.pro_until > base:
            base = user.pro_until
        user.pro_until = base + timedelta(days=pkg["days"])
        user.is_pro = True
        db.commit()
        db.refresh(user)
        msg = f"PRO активирован до {user.pro_until.strftime('%Y-%m-%d')}"

    return {
        "message": msg,
        "balance": user.balance,
        "response_credits": user.response_credits,
        # is_pro_active, а не колонка: клиенту нужен признак действующей
        # подписки, чтобы рисовать метку PRO.
        "is_pro": user.is_pro_active,
        "pro_until": user.pro_until
    }
