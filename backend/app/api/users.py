import csv
import io
import json
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.csrf import verify_csrf
from app.core.security import oauth2_scheme, decode_token, is_admin
from app.models import User, Review, Task, Transaction, UserRole, TaskStatus
from app.schemas import ProfileUpdate

router = APIRouter(tags=["Users"])

def decode_token_or_401(token: str) -> dict:
    return decode_token(token)

# Пути, по которым фронтенд реально отдаёт медиа: загруженные файлы
# (/files/<id>) и статика из uploads. Всё остальное должно быть http(s).
_SAFE_MEDIA_PREFIXES = ("/files/", "/uploads/", "/assets/")

_MAX_PORTFOLIO_ITEMS = 30
_MAX_MEDIA_URL_LEN = 500


def _safe_media_url(value: str) -> str:
    """Пропускает только http(s)-ссылку или внутренний путь к медиа.

    Иначе в `avatar` мог попасть `javascript:` или `data:text/html` — и
    превратиться в XSS, как только ссылку отрисуют без экранирования.
    """
    url = (value or "").strip()
    if not url:
        return ""
    if len(url) > _MAX_MEDIA_URL_LEN:
        raise HTTPException(400, "Ссылка на изображение слишком длинная")
    if url.startswith(_SAFE_MEDIA_PREFIXES):
        return url
    if url.startswith(("http://", "https://")):
        return url
    raise HTTPException(
        400, "Ссылка должна начинаться с http://, https:// или быть загруженным файлом"
    )


def _sanitize_portfolio(raw: str) -> str:
    """Проверяет портфолио как JSON-массив и чистит ссылки внутри.

    Поле хранится строкой с JSON, поэтому кривое значение ломало бы
    страницу профиля при разборе. Заодно прогоняем каждую ссылку через ту
    же проверку схемы, что и аватар.
    """
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "Портфолио должно быть JSON-массивом")

    if not isinstance(parsed, list):
        raise HTTPException(400, "Портфолио должно быть JSON-массивом")
    if len(parsed) > _MAX_PORTFOLIO_ITEMS:
        raise HTTPException(400, f"Не больше {_MAX_PORTFOLIO_ITEMS} работ в портфолио")

    cleaned = []
    for item in parsed:
        if isinstance(item, str):
            cleaned.append(_safe_media_url(item))
        elif isinstance(item, dict):
            entry = dict(item)
            for key in ("url", "image", "link"):
                if isinstance(entry.get(key), str) and entry[key]:
                    entry[key] = _safe_media_url(entry[key])
            cleaned.append(entry)
        else:
            raise HTTPException(400, "Элементы портфолио должны быть ссылками или объектами")

    return json.dumps(cleaned, ensure_ascii=False)

def user_online(user: User) -> bool:
    if not user.last_seen:
        return False
    try:
        # FIX: user.last_seen теперь datetime объект, не строка
        if isinstance(user.last_seen, str):
            # Обратная совместимость для старых записей
            last_seen_dt = datetime.fromisoformat(user.last_seen)
        else:
            last_seen_dt = user.last_seen
        return (datetime.now(timezone.utc) - last_seen_dt).total_seconds() < 120
    except Exception:
        return False

@router.get("/users/me")
def get_profile(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    rating = None
    completed_tasks = 0
    if user.role == UserRole.specialist:
        reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == "specialist").all()
        if reviews:
            rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
        completed_tasks = db.query(Task).filter(
            Task.executor_id == user.id,
            Task.status == TaskStatus.completed
        ).count()
    else:
        reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == "customer").all()
        if reviews:
            rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
        completed_tasks = db.query(Task).filter(
            Task.customer_id == user.id,
            Task.status == TaskStatus.completed
        ).count()

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "name": user.name,
        "bio": user.bio,
        "balance": user.balance,
        "city": user.city,
        "phone": user.phone,
        "avatar": user.avatar,
        "skills": user.skills,
        "portfolio": user.portfolio,
        "rating": rating,
        "verified": user.verified,
        # Права модератора считает бэкенд по ADMIN_EMAILS. Фронтенд раньше
        # угадывал их сам по хардкоду admin@delo.ru и подстроке "admin" —
        # это расходилось со списком на сервере и раскрывало админские
        # экраны тому, кто не имеет доступа к данным.
        "is_admin": is_admin(user),
        "is_pro": user.is_pro,
        "pro_until": user.pro_until,
        "response_credits": user.response_credits,
        "completed_tasks": completed_tasks,
        "online": user_online(user),
        "last_seen": user.last_seen
    }

@router.put("/users/me")
def update_profile(profile: ProfileUpdate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    if profile.name is not None:
        user.name = profile.name
    if profile.bio is not None:
        user.bio = profile.bio
    if profile.city is not None:
        user.city = profile.city
    if profile.phone is not None:
        user.phone = profile.phone

    # Аватар принимаем только как http(s)-ссылку или внутренний путь /files/...
    # Раньше значение писалось как есть, и в поле мог оказаться javascript:
    # или data:text/html — заготовка под stored XSS, срабатывающая в тот
    # момент, когда фронтенд отрисует ссылку без санитайза.
    if profile.avatar is not None:
        if profile.avatar == "":
            user.avatar = None  # пустая строка — удаляем аватар
        else:
            user.avatar = _safe_media_url(profile.avatar)

    if profile.skills is not None:
        user.skills = profile.skills

    if profile.portfolio is not None:
        if profile.portfolio != "":
            user.portfolio = _sanitize_portfolio(profile.portfolio)

    db.commit()
    db.refresh(user)

    return {"message": "Профиль успешно обновлён"}

@router.post("/users/me/switch-role")
def switch_role(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), _csrf: None = Depends(verify_csrf)):
    from app.core.security import create_access_token

    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    new_role = UserRole.specialist if user.role == UserRole.customer else UserRole.customer
    user.role = new_role
    db.commit()

    # Создаём новый токен с обновлённой ролью
    new_token = create_access_token({"sub": str(user.id), "role": new_role.value})

    return {
        "message": "Роль изменена",
        "role": new_role.value,
        "token": new_token  # Возвращаем новый токен
    }

@router.get("/specialists/")
def list_specialists(
    search: Optional[str] = None,
    city: Optional[str] = None,
    sort: str = Query("rating", pattern="^(rating|completed|reviews|newest)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Каталог специалистов с поиском, фильтром по городу, сортировкой и пагинацией."""
    query = db.query(User).filter(User.role == UserRole.specialist)
    if search:
        q = f"%{search}%"
        query = query.filter(
            User.name.ilike(q) | User.bio.ilike(q) | User.skills.ilike(q)
        )
    if city:
        query = query.filter(User.city.ilike(f"%{city}%"))

    specialists = query.all()
    items = []
    for u in specialists:
        reviews = db.query(Review).filter(Review.specialist_id == u.id, Review.target == "specialist").all()
        rating = round(sum(r.rating for r in reviews) / len(reviews), 1) if reviews else None
        completed = db.query(Task).filter(
            Task.executor_id == u.id, Task.status == TaskStatus.completed
        ).count()
        items.append({
            "id": u.id,
            "name": u.name,
            "bio": u.bio,
            "city": u.city,
            "avatar": u.avatar,
            "skills": u.skills,
            "verified": bool(u.verified),
            "is_pro": bool(u.is_pro),
            "rating": rating,
            "reviews_count": len(reviews),
            "completed_tasks": completed,
            "online": user_online(u),
        })

    if sort == "rating":
        items.sort(key=lambda x: (not x["is_pro"], -(x["rating"] or 0), -x["reviews_count"]))
    elif sort == "completed":
        items.sort(key=lambda x: (not x["is_pro"], -x["completed_tasks"], -(x["rating"] or 0)))
    elif sort == "reviews":
        items.sort(key=lambda x: (not x["is_pro"], -x["reviews_count"]))
    else:  # newest
        items.sort(key=lambda x: -x["id"])

    total = len(items)
    pages = max(1, (total + per_page - 1) // per_page)
    start = (page - 1) * per_page
    return {
        "items": items[start:start + per_page],
        "total": total,
        "page": page,
        "pages": pages,
        "per_page": per_page,
    }

@router.get("/wallet/transactions")
def get_my_transactions(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """История транзакций текущего пользователя (новые сверху)."""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    txs = db.query(Transaction).filter(Transaction.user_id == user_id).order_by(Transaction.id.desc()).all()
    task_ids = {t.task_id for t in txs if t.task_id}
    tasks = {t.id: t.title for t in db.query(Task).filter(Task.id.in_(task_ids)).all()} if task_ids else {}
    return [
        {
            "id": t.id,
            "amount": t.amount,
            "fee": t.fee or 0,
            "type": t.type.value if hasattr(t.type, "value") else str(t.type),
            "task_id": t.task_id,
            "task_title": tasks.get(t.task_id),
            "created_at": t.created_at,
        }
        for t in txs
    ]

@router.get("/wallet/transactions.csv")
def export_my_transactions_csv(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Выгрузка истории транзакций в CSV (UTF-8 с BOM — открывается в Excel)."""
    payload = decode_token_or_401(token)
    user_id = int(payload.get("sub"))
    txs = db.query(Transaction).filter(Transaction.user_id == user_id).order_by(Transaction.id.desc()).all()

    type_names = {
        "deposit": "Пополнение",
        "escrow_hold": "Заморозка (эскроу)",
        "escrow_release": "Выплата (эскроу)",
        "escrow_refund": "Возврат (эскроу)",
        "purchase": "Покупка пакета",
    }
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM для корректной кириллицы в Excel
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["ID", "Дата", "Тип", "Сумма (₽)", "Комиссия (₽)", "ID заказа"])
    def _fmt_dt(value):
        """created_at — объект datetime, а не строка.

        Раньше здесь было `(t.created_at or "")[:19]`, что падало с
        TypeError: 'datetime.datetime' object is not subscriptable —
        экспорт CSV отдавал 500 на любой непустой истории.
        """
        if not value:
            return ""
        try:
            return value.strftime("%Y-%m-%d %H:%M:%S")
        except AttributeError:
            # На случай, если в БД лежит строка (наследственные записи).
            return str(value)[:19].replace("T", " ")

    for t in txs:
        ttype = t.type.value if hasattr(t.type, "value") else str(t.type)
        writer.writerow([
            t.id,
            _fmt_dt(t.created_at),
            type_names.get(ttype, ttype),
            t.amount,
            t.fee or 0,
            t.task_id or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=delo_transactions.csv"},
    )

@router.get("/users/{user_id}/public")
def get_public_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    
    review_target = "specialist" if user.role == UserRole.specialist else "customer"
    rating = None
    reviews = db.query(Review).filter(Review.specialist_id == user.id, Review.target == review_target).all()
    if reviews:
        rating = round(sum(r.rating for r in reviews) / len(reviews), 1)
    
    if user.role == UserRole.specialist:
        completed_tasks = db.query(Task).filter(
            Task.executor_id == user.id,
            Task.status == TaskStatus.completed
        ).count()
    else:
        completed_tasks = db.query(Task).filter(
            Task.customer_id == user.id,
            Task.status == TaskStatus.completed
        ).count()

    return {
        "id": user.id,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "name": user.name,
        "bio": user.bio,
        "rating": rating,
        "reviews_count": len(reviews),
        "city": user.city,
        "avatar": user.avatar,
        "portfolio": user.portfolio,
        "skills": user.skills,
        "verified": user.verified,
        "is_pro": user.is_pro,
        "completed_tasks": completed_tasks,
        "online": user_online(user),
        "last_seen": user.last_seen
    }
