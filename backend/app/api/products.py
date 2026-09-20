import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.core.money import credit_balance, debit_balance
from app.core.csrf import verify_csrf
from app.core.logging import logger, log_escrow_operation
from app.core.cache import cache
from app.core.enums import enum_value
from app.models import (
    Product, Order, User, ProductCategory, ProductCondition, OrderStatus,
    Transaction, TransactionType, Notification, Dispute, DisputeStatus, UserRole
)
from app.schemas import ProductCreate, ProductOut, OrderCreate, OrderOut
from pydantic import BaseModel

router = APIRouter(prefix="/products", tags=["Products"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)


def _first_image(images: Optional[str]) -> Optional[str]:
    """Первое фото из JSON-массива. Кривая запись не должна ронять список."""
    if not images:
        return None
    try:
        parsed = json.loads(images)
    except (TypeError, ValueError):
        return None
    if isinstance(parsed, list) and parsed:
        return parsed[0]
    return None


def _serialize_product(p: Product, seller: Optional[User] = None) -> dict:
    """Единое представление товара для списка, «моих товаров» и деталей."""
    return {
        "id": p.id,
        "seller_id": p.seller_id,
        "title": p.title,
        "description": p.description,
        "category": enum_value(p.category),
        "condition": enum_value(p.condition),
        "price": p.price,
        "stock": p.stock,
        "images": p.images,
        "first_image": _first_image(p.images),
        "city": p.city,
        "delivery_options": p.delivery_options,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "seller_name": (seller.name or seller.email) if seller else None,
        "seller_avatar": seller.avatar if seller else None,
        "seller_verified": bool(seller.verified) if seller else False,
    }


# ============================================================================
# ТОВАРЫ
# ============================================================================

@router.post("/")
def create_product(
    product: ProductCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Создать товар (только для специалистов/продавцов)"""
    from app.core.security import rate_limit
    rate_limit(request, "create_product", limit=10, window_sec=300)

    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    # Роль читаем из БД, а не из JWT: в токене она может быть устаревшей.
    # Проверки не было вовсе, хотя эндпоинт заявлен как «только для
    # специалистов/продавцов» — товар мог разместить любой заказчик.
    seller = db.query(User).filter(User.id == user_id).first()
    if not seller:
        raise HTTPException(404, "Пользователь не найден")
    if seller.role != UserRole.specialist:
        raise HTTPException(403, "Размещать товары могут только специалисты")

    new_product = Product(
        seller_id=user_id,
        title=product.title,
        description=product.description,
        category=product.category,
        condition=product.condition,
        price=product.price,
        stock=product.stock,
        images=product.images,
        city=product.city,
        delivery_options=product.delivery_options,
        status="active"
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    cache.invalidate_pattern("products:list:*")

    return {"message": "Товар создан", "product_id": new_product.id}


@router.get("/")
def get_products(
    category: Optional[ProductCategory] = None,
    condition: Optional[ProductCondition] = None,
    search: Optional[str] = None,
    city: Optional[str] = None,
    price_min: Optional[int] = None,
    price_max: Optional[int] = None,
    page: Optional[int] = None,
    per_page: int = 20,
    db: Session = Depends(get_db)
):
    """Список товаров с фильтрами и пагинацией"""

    # Кеширование для списка без фильтров
    is_cacheable = (
        not category and not condition and not search and not city and
        price_min is None and price_max is None and not page
    )

    if is_cacheable:
        cache_key = "products:list:all"
        cached = cache.get(cache_key)
        if cached:
            try:
                logger.debug(f"Cache HIT: {cache_key}")
                return json.loads(cached)
            except json.JSONDecodeError:
                pass

    query = db.query(Product, User).join(User, Product.seller_id == User.id)

    # Только активные товары в наличии
    query = query.filter(Product.status == "active", Product.stock > 0)

    # Фильтры
    if category:
        query = query.filter(Product.category == category)
    if condition:
        query = query.filter(Product.condition == condition)
    if city:
        query = query.filter(Product.city.ilike(f"%{city}%"))
    if price_min is not None:
        query = query.filter(Product.price >= price_min)
    if price_max is not None:
        query = query.filter(Product.price <= price_max)
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Product.title.ilike(search_filter),
                Product.description.ilike(search_filter)
            )
        )

    # Сортировка (до пагинации!)
    query = query.order_by(Product.id.desc())

    # Пагинация
    if page:
        offset = (page - 1) * per_page
        query = query.offset(offset).limit(per_page)
    else:
        query = query.limit(per_page)

    results = query.all()

    result = [_serialize_product(p, seller) for p, seller in results]

    # Кеширование результата
    if is_cacheable:
        try:
            cache.set(cache_key, json.dumps(result, ensure_ascii=False, default=str), ttl_seconds=60)
            logger.debug(f"Cache SET: {cache_key}")
        except Exception as e:
            logger.warning(f"Cache set failed: {e}")

    return result


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
    escrow_tx = Transaction(
        user_id=buyer_id,
        amount=total_price,
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

    order.status = OrderStatus.confirmed

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

    order.status = OrderStatus.shipped
    order.tracking_number = req.tracking_number

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

    order.status = OrderStatus.completed

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

    order.status = OrderStatus.cancelled

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

    dispute = Dispute(order_id=order.id, opened_by=user_id, reason=reason)
    db.add(dispute)
    order.status = OrderStatus.disputed

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
        "status": order.status.value,
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


@router.get("/my")
def get_my_products(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    """Все товары текущего продавца — включая распроданные и снятые с продажи.

    Общий список (`GET /products/`) отдаёт только активные товары в наличии,
    поэтому продавец не видел ни распроданные позиции, ни удалённые — страница
    «Мои товары» фильтровала общий список на клиенте и половину теряла.

    ВАЖНО: объявлен до `/{product_id}`, иначе FastAPI попытался бы разобрать
    «my» как целочисленный id и вернул 422.
    """
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    products = (
        db.query(Product)
        .filter(Product.seller_id == user_id)
        .order_by(Product.id.desc())
        .all()
    )
    seller = db.query(User).filter(User.id == user_id).first()
    return [_serialize_product(p, seller) for p in products]


@router.get("/{product_id}")
def get_product_detail(product_id: int, db: Session = Depends(get_db)):
    """Детали товара"""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Товар не найден")

    seller = db.query(User).filter(User.id == product.seller_id).first()

    # Рейтинг продавца
    from sqlalchemy import func
    from app.models import Review
    seller_rating = None
    seller_reviews_count = 0
    if seller:
        rating_data = db.query(
            func.avg(Review.rating).label("avg_rating"),
            func.count(Review.id).label("count")
        ).filter(Review.specialist_id == seller.id).first()

        if rating_data and rating_data.count > 0:
            seller_rating = round(float(rating_data.avg_rating), 1)
            seller_reviews_count = rating_data.count

    return {
        "id": product.id,
        "seller_id": product.seller_id,
        "title": product.title,
        "description": product.description,
        "category": enum_value(product.category),
        "condition": enum_value(product.condition),
        "price": product.price,
        "stock": product.stock,
        "images": product.images,
        "city": product.city,
        "delivery_options": product.delivery_options,
        "status": product.status,
        "created_at": product.created_at.isoformat() if product.created_at else None,
        "seller_name": seller.name if seller else None,
        "seller_avatar": seller.avatar if seller else None,
        "seller_rating": seller_rating,
        "seller_reviews_count": seller_reviews_count,
        "seller_verified": seller.verified if seller else False
    }


@router.put("/{product_id}")
def update_product(
    product_id: int,
    product: ProductCreate,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Редактировать товар (только владелец)"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    existing = db.query(Product).filter(Product.id == product_id).first()
    if not existing:
        raise HTTPException(404, "Товар не найден")
    if existing.seller_id != user_id:
        raise HTTPException(403, "Редактировать может только владелец")

    existing.title = product.title
    existing.description = product.description
    existing.category = product.category
    existing.condition = product.condition
    existing.price = product.price
    existing.stock = product.stock
    existing.images = product.images
    existing.city = product.city
    existing.delivery_options = product.delivery_options

    db.commit()
    cache.invalidate_pattern("products:list:*")

    return {"message": "Товар обновлён"}


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf)
):
    """Удалить товар (пометить как removed)"""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))

    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Товар не найден")
    if product.seller_id != user_id:
        raise HTTPException(403, "Удалить может только владелец")

    product.status = "removed"
    db.commit()
    cache.invalidate_pattern("products:list:*")

    return {"message": "Товар удалён"}


