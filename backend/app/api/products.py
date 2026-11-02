import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.database import get_db
from app.core.security import oauth2_scheme, decode_token
from app.core.csrf import verify_csrf
from app.core.logging import logger
from app.core.cache import cache
from app.core.enums import enum_value
from app.models import (
    Product, User, ProductCategory, ProductCondition, UserRole
)
from app.schemas import ProductCreate
from app.api.product_orders import router as orders_router

router = APIRouter(prefix="/products", tags=["Products"])
# Заказы и споры по ним — в app/api/product_orders.py. Подключаем их
# первыми: `/products/orders` должен совпасть раньше, чем `/{product_id}`.
router.include_router(orders_router)

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
        # Каталог публичный: email продавца без имени сюда не подставляем.
        "seller_name": (seller.name or "Продавец") if seller else None,
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

    # Пагинация. per_page ограничен: раньше ?per_page=1000000 выгружал весь
    # каталог с продавцами одним запросом — дешёвый способ нагрузить базу.
    per_page = min(max(1, per_page), 50)
    if page:
        page = max(1, page)
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


