"""Заказы товаров маркетплейса и споры по ним.

Жизненный цикл заказа: оформление (деньги покупателя замораживаются
на эскроу), подтверждение и отправка продавцом, получение покупателем
(деньги уходят продавцу), отмена с возвратом и спор с арбитражем.

Маршруты подключаются в роутер каталога (app/api/products.py) раньше
`/products/{product_id}`: иначе `/products/orders` разбирался бы как
карточка товара с номером «orders».
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.core.money import credit_balance, debit_balance, claim
from app.core.csrf import verify_csrf
from app.core.logging import log_escrow_operation
from app.core.cache import cache
from app.core.enums import enum_value
from app.models import (
    Product, Order, User, OrderStatus, Transaction, TransactionType, Notification, Dispute
)
from app.schemas import OrderCreate
from pydantic import BaseModel

router = APIRouter()

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


# ============================================================================
# ЗАКАЗЫ
# ============================================================================

@router.post("/orders")
def create_order(
    order: OrderCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Создать заказ (купить товар)"""
    from app.core.security import rate_limit
    rate_limit(request, "create_order", limit=10, window_sec=300)

    payload = decode_token_or_401(token)
    buyer_id = int(payload.get("sub"))

    # Блокировка товара для предотвращения race condition
    product = db.query(Product).filter(Product.id == order.product_id).with_for_update().first()
    if not product:
        raise HTTPException(404, "Товар не найден")
    if product.status != "active":
        raise HTTPException(400, "Товар недоступен для покупки")
    if product.stock < order.quantity:
        raise HTTPException(400, f"Недостаточно товара на складе (доступно: {product.stock})")
    if product.seller_id == buyer_id:
        raise HTTPException(400, "Нельзя купить свой товар")

    # Проверка способа доставки
    if order.delivery_method == "delivery":
        if product.delivery_options == "pickup":
            raise HTTPException(400, "Для этого товара доступен только самовывоз")
        if not order.delivery_address:
            raise HTTPException(400, "Укажите адрес доставки")
    elif order.delivery_method == "pickup":
        if product.delivery_options == "delivery":
            raise HTTPException(400, "Для этого товара доступна только доставка")

    # Расчёт стоимости. Комиссия та же, что и в сделках по задачам: 0% для
    # продавца с действующей подпиской PRO (is_pro_active — флаг и срок),
    # иначе 5%.
    total_price = product.price * order.quantity
    seller = db.query(User).filter(User.id == product.seller_id).first()
    fee_percent = 0 if (seller and seller.is_pro_active) else 5
    platform_fee = round(total_price * fee_percent / 100)

    # Проверка баланса покупателя
    buyer = db.query(User).filter(User.id == buyer_id).with_for_update().first()
    if not buyer:
        raise HTTPException(404, "Покупатель не найден")
    if buyer.balance < total_price:
        raise HTTPException(400, f"Недостаточно средств. Требуется {total_price} ₽, доступно {buyer.balance} ₽")

    # Заморозить деньги в эскроу. Списание атомарное: две одновременные
    # покупки одного покупателя иначе обе прошли бы проверку баланса
    # (см. app/core/money.py).
    if not debit_balance(db, buyer_id, total_price):
        db.rollback()
        raise HTTPException(
            400,
            f"Недостаточно средств. Требуется {total_price} ₽, доступно {buyer.balance or 0} ₽",
        )
    # Сумма со знаком минус — как у заморозки по заданиям (tasks.assign_task)
    # и как у любого списания: история кошелька показывает знак как есть, и
    # положительная заморозка выглядела у покупателя как поступление денег.
    escrow_tx = Transaction(
        user_id=buyer_id,
        amount=-total_price,
        type=TransactionType.escrow_hold,
        task_id=None,  # для товаров используем order
        fee=0
    )
    db.add(escrow_tx)
    db.flush()  # получить ID транзакции

    # Уменьшить остаток. Проверка «хватит ли товара» входит в сам UPDATE:
    # with_for_update на SQLite игнорируется, и два одновременных заказа
    # на последнюю единицу прошли бы оба.
    claimed = (
        db.query(Product)
        .filter(
            Product.id == product.id,
            Product.status == "active",
            Product.stock >= order.quantity,
        )
        .update({"stock": Product.stock - order.quantity}, synchronize_session=False)
    )
    if claimed != 1:
        db.rollback()
        raise HTTPException(400, "Товар закончился — обновите страницу")

    # Распродано помечаем отдельным условием, а не по значению в памяти
    db.query(Product).filter(
        Product.id == product.id, Product.stock == 0
    ).update({"status": "sold_out"}, synchronize_session=False)

    # Создать заказ
    new_order = Order(
        product_id=product.id,
        buyer_id=buyer_id,
        seller_id=product.seller_id,
        quantity=order.quantity,
        total_price=total_price,
        delivery_method=order.delivery_method,
        delivery_address=order.delivery_address,
        status=OrderStatus.pending,
        escrow_transaction_id=escrow_tx.id,
        platform_fee=platform_fee
    )
    db.add(new_order)

    # Уведомление продавцу
    db.add(Notification(
        user_id=product.seller_id,
        type="new_order",
        title="Новый заказ!",
        text=f"Получен заказ на товар «{product.title}» на сумму {total_price} ₽",
        task_id=None
    ))

    db.commit()
    db.refresh(new_order)

    log_escrow_operation(
        operation="order_escrow_hold",
        task_id=new_order.id,
        user_id=buyer_id,
        amount=total_price,
        fee=0
    )

    cache.invalidate_pattern("products:list:*")

    return {"message": "Заказ создан", "order_id": new_order.id}


@router.get("/orders")
def get_my_orders(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Мои заказы (покупки и продажи)"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # Покупки
    purchases = db.query(Order, Product, User).join(
        Product, Order.product_id == Product.id
    ).join(
        User, Order.seller_id == User.id
    ).filter(Order.buyer_id == user_id).order_by(Order.id.desc()).all()

    # Продажи
    sales = db.query(Order, Product, User).join(
        Product, Order.product_id == Product.id
    ).join(
        User, Order.buyer_id == User.id
    ).filter(Order.seller_id == user_id).order_by(Order.id.desc()).all()

    def format_order(o, p, counterparty):
        first_image = None
        if p.images:
            try:
                imgs = json.loads(p.images)
                if imgs and isinstance(imgs, list):
                    first_image = imgs[0]
            except:
                pass

        return {
            "id": o.id,
            "product_id": o.product_id,
            "product_title": p.title,
            "product_image": first_image,
            "buyer_id": o.buyer_id,
            "seller_id": o.seller_id,
            "quantity": o.quantity,
            "total_price": o.total_price,
            "delivery_method": o.delivery_method,
            "delivery_address": o.delivery_address,
            "tracking_number": o.tracking_number,
            "status": enum_value(o.status),
            "platform_fee": o.platform_fee,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "counterparty_name": counterparty.name or counterparty.email,
            "counterparty_avatar": counterparty.avatar
        }

    return {
        "purchases": [format_order(o, p, seller) for o, p, seller in purchases],
        "sales": [format_order(o, p, buyer) for o, p, buyer in sales]
    }


@router.get("/orders/{order_id}")
def get_order_detail(
    order_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Детали заказа"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.buyer_id != user_id and order.seller_id != user_id:
        raise HTTPException(403, "Нет доступа к этому заказу")

    product = db.query(Product).filter(Product.id == order.product_id).first()
    buyer = db.query(User).filter(User.id == order.buyer_id).first()
    seller = db.query(User).filter(User.id == order.seller_id).first()

    return {
        "id": order.id,
        "product_id": order.product_id,
        "product_title": product.title if product else None,
        "product_image": product.images if product else None,
        "buyer_id": order.buyer_id,
        "buyer_name": buyer.name if buyer else None,
        "seller_id": order.seller_id,
        "seller_name": seller.name if seller else None,
        "quantity": order.quantity,
        "total_price": order.total_price,
        "delivery_method": order.delivery_method,
        "delivery_address": order.delivery_address,
        "tracking_number": order.tracking_number,
        "status": enum_value(order.status),
        "platform_fee": order.platform_fee,
        "created_at": order.created_at.isoformat() if order.created_at else None
    }


class OrderConfirmRequest(BaseModel):
    pass

@router.post("/orders/{order_id}/confirm")
def confirm_order(
    order_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Продавец подтверждает заказ"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.seller_id != user_id:
        raise HTTPException(403, "Подтвердить может только продавец")
    if order.status != OrderStatus.pending:
        raise HTTPException(400, f"Нельзя подтвердить заказ со статусом {order.status}")

    # Переход статуса — условным UPDATE (money.claim): with_for_update выше
    # на SQLite игнорируется, и одновременные запросы проходили проверку оба.
    if not claim(db, Order, [Order.id == order.id, Order.status == OrderStatus.pending],
                 {"status": OrderStatus.confirmed}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")

    db.add(Notification(
        user_id=order.buyer_id,
        type="order_confirmed",
        title="Заказ подтверждён",
        text=f"Продавец подтвердил ваш заказ #{order.id}",
        task_id=None
    ))

    db.commit()
    return {"message": "Заказ подтверждён"}


class OrderShipRequest(BaseModel):
    tracking_number: str

@router.post("/orders/{order_id}/ship")
def ship_order(
    order_id: int,
    req: OrderShipRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Продавец отправил товар"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.seller_id != user_id:
        raise HTTPException(403, "Отправить может только продавец")
    if order.status != OrderStatus.confirmed:
        raise HTTPException(400, "Заказ должен быть подтверждён")

    # Переход статуса — условным UPDATE (money.claim): with_for_update выше
    # на SQLite игнорируется, и одновременные запросы проходили проверку оба.
    if not claim(db, Order, [Order.id == order.id, Order.status == OrderStatus.confirmed],
                 {"status": OrderStatus.shipped, "tracking_number": req.tracking_number}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")

    db.add(Notification(
        user_id=order.buyer_id,
        type="order_shipped",
        title="Товар отправлен",
        text=f"Ваш заказ #{order.id} отправлен. Трек-номер: {req.tracking_number}",
        task_id=None
    ))

    db.commit()
    return {"message": "Заказ отправлен", "tracking_number": req.tracking_number}


@router.post("/orders/{order_id}/complete")
def complete_order(
    order_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Покупатель подтверждает получение → деньги продавцу"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.buyer_id != user_id:
        raise HTTPException(403, "Завершить может только покупатель")
    if order.status == OrderStatus.completed:
        raise HTTPException(400, "Заказ уже завершён")
    if order.status == OrderStatus.cancelled:
        raise HTTPException(400, "Заказ отменён")
    if order.status == OrderStatus.disputed:
        raise HTTPException(400, "По заказу открыт спор")

    # Продавец обязателен: раньше выплата была завёрнута в `if seller`, и при
    # отсутствующем продавце заказ помечался завершённым, деньги покупателя
    # оставались списанными, а выплата не происходила — молча и без уведомлений.
    seller = db.query(User).filter(User.id == order.seller_id).with_for_update().first()
    if not seller:
        raise HTTPException(
            409, "Продавец заказа не найден — завершение невозможно, обратитесь в поддержку"
        )

    # Переход статуса — условным UPDATE (money.claim): with_for_update выше
    # на SQLite игнорируется, и одновременные запросы проходили проверку оба.
    # Без этого одновременные «получил» и «отменить»/«спор» давали и выплату
    # продавцу, и возврат покупателю.
    if not claim(db, Order,
                 [Order.id == order.id,
                  Order.status.in_([OrderStatus.pending, OrderStatus.confirmed, OrderStatus.shipped])],
                 {"status": OrderStatus.completed}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")

    # Перевести деньги продавцу. Начисление делает сам UPDATE, а не Python:
    # при конкурентной записи баланса инкремент в приложении потерялся бы.
    payout = order.total_price - order.platform_fee
    credit_balance(db, seller.id, payout)
    db.add(Transaction(
        user_id=seller.id,
        amount=payout,
        type=TransactionType.escrow_release,
        task_id=None,
        fee=order.platform_fee
    ))

    log_escrow_operation(
        operation="order_escrow_release",
        task_id=order.id,
        user_id=seller.id,
        amount=payout,
        fee=order.platform_fee
    )

    db.add(Notification(
        user_id=seller.id,
        type="order_completed",
        title="Заказ завершён!",
        text=f"Покупатель подтвердил получение заказа #{order.id}. {payout} ₽ переведены на ваш баланс",
        task_id=None
    ))

    db.commit()

    return {
        "message": "Заказ завершён",
        "released": payout,
        "fee": order.platform_fee
    }


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Отменить заказ (только pending) → возврат средств"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.buyer_id != user_id and order.seller_id != user_id:
        raise HTTPException(403, "Отменить может только покупатель или продавец")
    # Отменить можно и подтверждённый заказ — пока продавец его не отправил.
    # Раньше отмена работала только для pending: если продавец подтвердил заказ
    # и перестал отвечать, деньги покупателя оставались в эскроу навсегда —
    # ни отменить, ни оспорить (эндпоинта спора по товарам нет).
    if order.status not in (OrderStatus.pending, OrderStatus.confirmed):
        raise HTTPException(400, "Отменить можно только заказ, который продавец ещё не отправил")

    buyer = db.query(User).filter(User.id == order.buyer_id).with_for_update().first()
    if not buyer:
        raise HTTPException(
            409, "Покупатель заказа не найден — отмена невозможна, обратитесь в поддержку"
        )

    # Переход статуса — условным UPDATE (money.claim): with_for_update выше
    # на SQLite игнорируется, и одновременные запросы проходили проверку оба.
    if not claim(db, Order,
                 [Order.id == order.id,
                  Order.status.in_([OrderStatus.pending, OrderStatus.confirmed])],
                 {"status": OrderStatus.cancelled}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")

    # Вернуть деньги покупателю (начисление — атомарным UPDATE)
    credit_balance(db, buyer.id, order.total_price)
    db.add(Transaction(
        user_id=buyer.id,
        amount=order.total_price,
        type=TransactionType.escrow_refund,
        task_id=None,
        fee=0
    ))

    # Вернуть остаток товара
    db.query(Product).filter(Product.id == order.product_id).update(
        {"stock": Product.stock + order.quantity}, synchronize_session=False
    )
    db.query(Product).filter(
        Product.id == order.product_id, Product.status == "sold_out"
    ).update({"status": "active"}, synchronize_session=False)

    # Уведомления
    db.add(Notification(
        user_id=order.buyer_id,
        type="order_cancelled",
        title="Заказ отменён",
        text=f"Заказ #{order.id} отменён. {order.total_price} ₽ возвращены на баланс",
        task_id=None
    ))

    db.add(Notification(
        user_id=order.seller_id,
        type="order_cancelled",
        title="Заказ отменён",
        text=f"Заказ #{order.id} был отменён",
        task_id=None
    ))

    db.commit()

    cache.invalidate_pattern("products:list:*")

    return {"message": "Заказ отменён, средства возвращены"}


class OrderDisputeCreate(BaseModel):
    reason: str


@router.post("/orders/{order_id}/dispute")
def open_order_dispute(
    order_id: int,
    req: OrderDisputeCreate,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Открыть спор по заказу товара.

    Раньше этого пути не существовало вовсе: `OrderStatus.disputed` был объявлен,
    но недостижим, `complete_order` отклонял такой статус, а `cancel_order`
    работал только до отправки. В результате покупатель, получивший брак или
    ничего не получивший после отправки, не мог ни завершить, ни отменить,
    ни оспорить заказ — деньги оставались в эскроу бессрочно.

    Спор доступен обоим участникам и только по заказу, который продавец уже
    принял (pending отменяется обычной отменой, там деньги ещё не «в работе»).
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if user_id not in (order.buyer_id, order.seller_id):
        raise HTTPException(403, "Открыть спор могут только участники заказа")
    if order.status == OrderStatus.disputed:
        raise HTTPException(400, "По этому заказу уже открыт спор")
    if order.status in (OrderStatus.completed, OrderStatus.cancelled):
        raise HTTPException(400, f"Нельзя открыть спор по заказу со статусом {order.status.value}")
    if order.status == OrderStatus.pending:
        raise HTTPException(
            400, "Заказ ещё не принят продавцом — отмените его вместо открытия спора"
        )

    reason = (req.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(400, "Опишите причину спора (минимум 5 символов)")

    # Переход статуса — условным UPDATE (money.claim): with_for_update выше
    # на SQLite игнорируется, и одновременные запросы проходили проверку оба.
    if not claim(db, Order,
                 [Order.id == order.id,
                  Order.status.in_([OrderStatus.confirmed, OrderStatus.shipped])],
                 {"status": OrderStatus.disputed}):
        db.rollback()
        raise HTTPException(409, "Статус заказа изменился, обновите страницу")
    dispute = Dispute(order_id=order.id, opened_by=user_id, reason=reason)
    db.add(dispute)

    other_id = order.seller_id if user_id == order.buyer_id else order.buyer_id
    db.add(Notification(
        user_id=other_id,
        type="order_dispute",
        title="Открыт спор по заказу",
        text=f"По заказу #{order.id} открыт спор. Средства заморожены до решения арбитража.",
        task_id=None
    ))
    db.commit()
    db.refresh(dispute)

    return {
        "message": "Спор открыт. Средства заморожены до решения арбитража.",
        "dispute_id": dispute.id,
        "status": OrderStatus.disputed.value,
    }


@router.get("/orders/{order_id}/dispute")
def get_order_dispute(
    order_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Текущий спор по заказу — для участников и арбитров."""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    user = db.query(User).filter(User.id == user_id).first()
    if user_id not in (order.buyer_id, order.seller_id) and not is_admin(user):
        raise HTTPException(403, "Нет доступа к информации о споре")

    dispute = (
        db.query(Dispute)
        .filter(Dispute.order_id == order_id)
        .order_by(Dispute.id.desc())
        .first()
    )
    if not dispute:
        return {"dispute": None}

    opener = db.query(User).filter(User.id == dispute.opened_by).first()
    return {"dispute": {
        "id": dispute.id,
        "order_id": dispute.order_id,
        "opened_by": dispute.opened_by,
        "opened_by_name": (opener.name or opener.email) if opener else None,
        "reason": dispute.reason,
        "status": enum_value(dispute.status),
        "resolution_comment": dispute.resolution_comment,
        "created_at": dispute.created_at,
        "resolved_at": dispute.resolved_at,
    }}
