from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os

from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.models import User, StoredFile
from app.api import (
    auth_router,
    users_router,
    tasks_router,
    responses_router,
    reviews_router,
    chat_router,
    payments_router,
    files_router,
    notifications_router,
    ai_router,
    disputes_router,
    verification_router,
    withdrawals_router,
    admin_router
)
from file_utils import UPLOAD_DIR
from jose import jwt
from datetime import datetime

# Initialize Database tables
Base.metadata.create_all(bind=engine)

# Для развёртывания «из коробки»: если выставлен SEED_DEMO=1 и база пустая,
# засеиваем демо-данные. В обычной разработке выключено.
if os.environ.get("SEED_DEMO", "").lower() in ("1", "true", "yes"):
    try:
        from sqlalchemy import func as _func
        with SessionLocal() as _db:
            if (_db.query(_func.count(User.id)).scalar() or 0) == 0:
                from seed_demo import main as _seed_main
                _seed_main()
                print("[seed] база пуста — засеяна демо-данными")
    except Exception as _exc:
        print(f"[seed] засеять не удалось: {_exc}")

def _run_column_migrations():
    """Добавляет новые колонки в уже существующие таблицы.

    Это заплатка для баз, созданных до появления колонки: `create_all` новые
    колонки в существующие таблицы не добавляет. Ошибки больше не глотаются
    молча — «колонка уже есть» это ожидаемый случай, всё остальное печатаем.
    Иначе сломанная миграция выглядит как успешный старт, а падает потом —
    на первом запросе к несуществующей колонке, и искать причину негде.
    """
    from sqlalchemy import text
    is_pg = "postgresql" in settings.DB_URL
    ck = "IF NOT EXISTS " if is_pg else ""
    migrations = [
        f"ALTER TABLE users ADD COLUMN {ck}last_seen VARCHAR",
        f"ALTER TABLE reviews ADD COLUMN {ck}target VARCHAR DEFAULT 'specialist'",
        f"ALTER TABLE users ADD COLUMN {ck}response_credits INTEGER DEFAULT 5",
        f"ALTER TABLE users ADD COLUMN {ck}is_pro BOOLEAN DEFAULT false",
        f"ALTER TABLE users ADD COLUMN {ck}pro_until VARCHAR",
        f"ALTER TABLE transactions ADD COLUMN {ck}fee INTEGER DEFAULT 0",
    ]
    # SQLite не поддерживает ADD COLUMN IF NOT EXISTS и сообщает о повторе текстом
    already_applied = ("duplicate column name", "already exists")

    for m in migrations:
        with engine.connect() as conn:
            try:
                conn.execute(text(m))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                if any(marker in str(exc).lower() for marker in already_applied):
                    continue  # колонка уже есть — нормальный случай
                print(f"[migrations] НЕ ПРИМЕНИЛАСЬ: {m} — {exc}")

_run_column_migrations()

app = FastAPI(
    title="Marketplace Platform API",
    description="API для платформы поиска специалистов и заказчиков «ДЕЛО»",
    version="2.0.0"
)

# CORS middleware - только явно разрешённые источники (см. app/core/config.py).
# Раньше был allow_origins=["*"] + allow_origin_regex=".*" + credentials —
# для API с деньгами это недопустимо широко.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# Online presence tracking
_seen_cache: dict[int, datetime] = {}

@app.middleware("http")
async def track_last_seen(request: Request, call_next):
    response = await call_next(request)
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = jwt.decode(auth[7:], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            uid = int(payload.get("sub"))
            now = datetime.utcnow()
            last = _seen_cache.get(uid)
            if last is None or (now - last).total_seconds() > 60:
                db = SessionLocal()
                try:
                    db.query(User).filter(User.id == uid).update({"last_seen": now.isoformat()})
                    db.commit()
                finally:
                    db.close()
                _seen_cache[uid] = now
        except Exception:
            pass
    return response

# Mount upload directory
Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Include all modular routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(tasks_router)
app.include_router(responses_router)
app.include_router(reviews_router)
app.include_router(chat_router)
app.include_router(payments_router)
app.include_router(files_router)
app.include_router(notifications_router)
app.include_router(ai_router)
app.include_router(disputes_router)
app.include_router(verification_router)
app.include_router(withdrawals_router)
app.include_router(admin_router)

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Фронтенд (SPA) с того же порта.
#
# API-роутеры зарегистрированы выше и побеждают при совпадении пути, поэтому
# /tasks/{id} и прочие API-пути отдают JSON, а всё остальное — страницы React
# Router. Это то же поведение, что у продакшн-nginx (frontend/nginx.conf).
# Если сборки нет, приложение работает как чистый API и здесь ничего не ломается.
# ---------------------------------------------------------------------------
_FRONTEND_DIST = os.environ.get("DIST_DIR") or next(
    (
        str(candidate)
        for candidate in (
            Path(__file__).parent / "dist",
            Path(__file__).parent / "static",
            Path(__file__).parent.parent / "frontend" / "dist",
        )
        if candidate.exists()
    ),
    str(Path(__file__).parent.parent / "frontend" / "dist"),
)
_frontend_index = Path(_FRONTEND_DIST, "index.html")

if _frontend_index.exists():
    from fastapi.responses import FileResponse

    # Собранные js/css/иконки лежат в dist/assets — отдаём как файлы
    if Path(_FRONTEND_DIST, "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(Path(_FRONTEND_DIST, "assets"))), name="spa-assets")

    @app.get("/", include_in_schema=False)
    def spa_root():
        return FileResponse(str(_frontend_index))

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        # Реальный файл из сборки (manifest, favicon и т.п.) отдаём как есть,
        # всё остальное — страница SPA (её маршруты обрабатывает React Router)
        candidate = Path(_FRONTEND_DIST, full_path)
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_frontend_index))
