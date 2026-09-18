from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.security import oauth2_scheme, decode_token
from app.core.money import credit_balance, debit_balance
from app.core.csrf import verify_csrf
from app.core.logging import logger, log_escrow_operation
from app.core.cache import cache
from app.models import (
    User, Transaction, PaymentRecord, PaymentStatus, Task, Notification,
    UserRole, TaskStatus, TransactionType,
)
from app.schemas import DepositRequest
from pydantic import BaseModel
import payments
from app.integrations import yoomoney

router = APIRouter(tags=["Payments"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

DEMO_DEPOSIT_MAX = 100000

# Схема платежей на пополнение баланса: как подтверждение перестало
# доверять клиенту.
#
# Раньше `/payments/confirm` брал `payment_id` из query-строки и передавал его
# провайдеру. Если провайдер отвечал `paid: true`, баланс пополнялся. Запись
# `PaymentRecord` искалась по тому же значению, которое прислал клиент, и
# найденная строка молча принималась за достаточное доказательство оплаты.
#
# Дыра была не в самом ответе провайдера, а в отсутствии вопроса «а это точно
# тот платёж, который мы создали?». У ЮKassa `confirmation_url` не сохранялся
# и не проверялся нигде, поэтому подтвердить можно было, ни разу не открыв
# страницу оплаты: достаточно было знать `payment_id`.
#
# Проверка ниже закрывает это, не обращаясь к провайдеру: `confirmation_url`
# приходит в `/payments/create` от провайдера, сохраняется в записи и назад к
# нам возвращается только через нашего же клиента. Клиент этот URL не
# формирует и подделать не может — не зная его, подтверждение не пройдёт.
#
# Заодно проверяется владелец: иначе чужой платёж можно было бы подтвердить
# из-под своего аккаунта.


def _verify_local_record(
    db: Session,
    payment_id: str,
    user_id: int,
    confirmation_url: Optional[str],
) -> PaymentRecord:
    """Убедиться, что подтверждается НАШ платёж, и вернуть его запись.

    Бросает 4xx, если строки нет, она принадлежит другому пользователю или
    предъявленный `confirmation_url` не совпадает с сохранённым при создании.
    """
    record = db.query(PaymentRecord).filter(PaymentRecord.payment_id == payment_id).first()
    if not record:
        logger.warning(
            f"Payment {payment_id} is paid but has no local record — crediting refused"
        )
        raise HTTPException(409, "Платёж не найден. Обратитесь в поддержку.")

    if record.user_id != user_id:
        raise HTTPException(403, "Платёж не принадлежит этому пользователю")

    # Старые записи (созданные до появления этой колонки) не несут URL —
    # для них подтверждение невозможно, и это честный отказ, а не пропуск
    # проверки: доверять им значило бы оставить дыру открытой.
    if not record.confirmation_url:
        logger.warning(
            f"Payment {payment_id} has no stored confirmation_url — "
            f"confirmation refused (record created before the column existed)"
        )
        raise HTTPException(
            409,
            "Платёж нельзя подтвердить автоматически. Обратитесь в поддержку.",
        )

    if not confirmation_url:
        raise HTTPException(
            400,
            "Не указан confirmation_url — повторный ответ провайдера не найден. "
            "Начните оплату заново.",
        )

    if confirmation_url != record.confirmation_url:
        logger.warning(
            f"Payment {payment_id}: confirmation_url mismatch "
            f"(given={confirmation_url!r}, stored={record.confirmation_url!r}) — refused"
        )
        raise HTTPException(403, "Платёж не соответствует созданному — подтверждение отклонено")

    return record


MONETIZATION_PACKAGES = {
    "resp_10": {"type": "responses", "title": "10 откликов", "credits": 10, "price": 190},
    "resp_50": {"type": "responses", "title": "50 откликов", "credits": 50, "price": 790},
    "pro_1": {"type": "pro", "title": "PRO на 1 месяц", "days": 30, "price": 590},
    "pro_3": {"type": "pro", "title": "PRO на 3 месяца", "days": 90, "price": 1490},
    "pro_12": {"type": "pro", "title": "PRO на год", "days": 365, "price": 4900},
}

class BuyPackageRequest(BaseModel):
    package_id: str

class PaymentProviderRequest(BaseModel):
    provider: str = "yoomoney"  # "yoomoney" или "yookassa"

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

    credit_balance(db, user.id, req.amount)
    tx = Transaction(user_id=user.id, amount=req.amount, type=TransactionType.deposit)
    db.add(tx)
    db.commit()
    db.refresh(user)
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

@router.get("/payments/status")
def payments_status():
    return {
        "yookassa": {"configured": payments.is_configured()},
        "yoomoney": {"configured": yoomoney.is_configured()}
    }

@router.post("/payments/create")
def create_payment(
    req: DepositRequest,
    provider: str = "yoomoney",
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """
    Создать платеж для пополнения баланса.

    Args:
        provider: "yoomoney" или "yookassa"
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if req.amount <= 0:
        raise HTTPException(400, "Сумма должна быть больше 0")

    # Выбираем провайдера
    if provider == "yoomoney":
        if not yoomoney.is_configured():
            raise HTTPException(400, "ЮMoney не настроен. Используйте другой способ оплаты.")

        result = yoomoney.create_payment(
            amount=req.amount,
            description=f"Пополнение баланса «ДЕЛО» на {req.amount} руб.",
            metadata={"user_id": str(user_id), "amount": str(req.amount)}
        )

        if "error" in result:
            raise HTTPException(502, f"Ошибка создания платежа: {result['error']}")

        payment_id = result["payment_id"]
        confirmation_url = result["confirmation_url"]

    elif provider == "yookassa":
        if not payments.is_configured():
            raise HTTPException(400, "ЮKassa не настроена. Используйте другой способ оплаты.")

        result = payments.create_payment(
            amount=req.amount,
            description=f"Пополнение баланса «ДЕЛО» на {req.amount} руб.",
            metadata={"user_id": str(user_id), "amount": str(req.amount)}
        )

        if "error" in result:
            raise HTTPException(502, f"Ошибка создания платежа: {result['error']}")

        payment_id = result["payment_id"]
        confirmation_url = result["confirmation_url"]

    else:
        raise HTTPException(400, f"Неизвестный провайдер: {provider}")

    # Фиксируем платёж ДО ухода пользователя на страницу оплаты: это
    # единственный достоверный источник user_id и суммы для вебхука.
    # Без этой записи вебхук вынужден доверять label из запроса, а его
    # формирует плательщик (см. комментарий к PaymentRecord).
    #
    # `confirmation_url` сохраняем ровно затем, чтобы при подтверждении было
    # с чем сверить присланный клиентом `payment_id`. URL рождается здесь из
    # ответа провайдера и через наш код больше не проходит — клиент его не
    # формирует. Значит, совпадение подтверждает, что подтверждается именно
    # тот платёж, который мы создали.
    db.add(PaymentRecord(
        payment_id=payment_id,
        user_id=user_id,
        amount=req.amount,
        provider=provider,
        status=PaymentStatus.created,
        confirmation_url=confirmation_url,
    ))
    db.commit()

    return {
        "provider": provider,
        "payment_id": payment_id,
        "confirmation_url": confirmation_url,
    }

@router.post("/payments/confirm")
def confirm_payment(
    payment_id: str,
    provider: str = "yoomoney",
    confirmation_url: Optional[str] = None,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """
    Подтвердить и зачислить платеж.

    Сумма и получатель берутся из записи, созданной нами при оформлении
    платежа, а не из ответа провайдера: метаданные платежа тоже уходят в
    браузер и не годятся как источник доверия.

    `confirmation_url` — обязательный аргумент (приходит из `POST
    /payments/create` для этого же `payment_id`). Без него запрос отклоняется:
    см. `_verify_local_record` — он объясняет, почему одной записи в базе для
    подтверждения недостаточно.
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # Делаем это ДО обращения к провайдеру: незачем ходить во внешний сервис,
    # если подтверждается не наша запись.
    record = _verify_local_record(db, payment_id, user_id, confirmation_url)

    # Выбираем провайдера
    if provider == "yoomoney":
        status_result = yoomoney.get_payment_status(payment_id)
    elif provider == "yookassa":
        status_result = payments.get_payment_status(payment_id)
    else:
        raise HTTPException(400, f"Неизвестный провайдер: {provider}")

    if "error" in status_result:
        raise HTTPException(502, f"Ошибка проверки платежа: {status_result['error']}")

    if not status_result.get("paid"):
        return {"status": status_result["status"], "credited": False}

    # Идемпотентность: платёж мог уже быть зачислен вебхуком
    if record.credited_at is not None:
        return {"status": "succeeded", "credited": False, "message": "Уже зачислено"}

    amount = record.amount
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    credit_balance(db, user_id, amount)
    db.add(Transaction(user_id=user_id, amount=amount, type=TransactionType.deposit))
    record.status = PaymentStatus.paid
    record.credited_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    return {"status": "succeeded", "credited": True, "new_balance": user.balance}

@router.post("/payments/webhook/yoomoney")
async def yoomoney_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Вебхук для уведомлений от ЮMoney.

    ЮMoney отправляет POST запрос с параметрами:
    - notification_type
    - operation_id
    - amount
    - currency
    - datetime
    - sender
    - codepro
    - label
    - sha1_hash

    Эндпоинт обязательно async: тело приходит как form-data, а `request.form()`
    — корутина на event loop сервера. Раньше здесь стоял sync-`def` с
    `asyncio.run(...)` внутри, что создавало второй event loop и роняло
    обработку — платежи не зачислялись вовсе.
    """
    # Получаем все параметры из формы
    try:
        form_data = await request.form()
    except Exception as exc:
        logger.warning(f"ЮMoney webhook: cannot parse form data: {exc}")
        raise HTTPException(400, "Invalid form data")

    notification_data = dict(form_data)

    # Проверяем подпись
    if not yoomoney.verify_webhook(notification_data):
        logger.warning(f"Invalid ЮMoney webhook signature: {notification_data}")
        raise HTTPException(403, "Invalid signature")

    # Извлекаем данные
    label = notification_data.get("label")
    amount_raw = notification_data.get("amount", 0)
    operation_id = notification_data.get("operation_id")

    if not label or not operation_id:
        raise HTTPException(400, "Missing label or operation_id")

    record = db.query(PaymentRecord).filter(PaymentRecord.payment_id == label).first()

    # Платежа с таким label мы не создавали — значит, label подделал
    # плательщик (он уходит через браузер и легко меняется в форме).
    # Зачислять по нему нельзя никому.
    if not record:
        logger.warning(
            f"ЮMoney webhook for unknown label={label!r} "
            f"(amount={amount_raw}, operation_id={operation_id}) — rejected"
        )
        raise HTTPException(404, "Unknown payment label")

    if record.credited_at is not None:
        logger.info(f"ЮMoney payment {label} already credited")
        return {"status": "ok"}

    # Сверяем сумму с той, что мы зафиксировали при создании платежа:
    # провайдер присылает её в уведомлении, и расхождение означает либо
    # подмену, либо ошибку — зачисляем ровно запрошенное.
    try:
        notified_amount = int(float(amount_raw))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid amount")

    if notified_amount != record.amount:
        logger.warning(
            f"ЮMoney amount mismatch for {label}: notified={notified_amount}, "
            f"expected={record.amount} — crediting expected amount"
        )

    user_id = record.user_id
    amount = record.amount

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.error(f"User {user_id} not found for payment {label}")
        raise HTTPException(404, "User not found")

    credit_balance(db, user_id, amount)
    db.add(Transaction(user_id=user_id, amount=amount, type=TransactionType.deposit))
    record.status = PaymentStatus.paid
    record.credited_at = datetime.utcnow()

    # Отправляем уведомление пользователю
    db.add(Notification(
        user_id=user_id,
        type="payment",
        title="Баланс пополнен",
        text=f"Ваш баланс пополнен на {amount} ₽ через ЮMoney"
    ))

    db.commit()

    logger.info(f"ЮMoney payment {label} credited: {amount} RUB to user {user_id}")

    return {"status": "ok"}

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

    task.executor_id = specialist_id
    task.status = TaskStatus.in_progress
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
