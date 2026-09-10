from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

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
    ai_router
)
from file_utils import UPLOAD_DIR
from jose import jwt
from datetime import datetime

# Initialize Database tables
Base.metadata.create_all(bind=engine)

def _run_column_migrations():
    """Добавляет новые колонки в уже существующие таблицы при необходимости"""
    from sqlalchemy import text
    is_pg = "postgresql" in settings.DB_URL
    ck = "IF NOT EXISTS " if is_pg else ""
    migrations = [
        f"ALTER TABLE users ADD COLUMN {ck}last_seen VARCHAR",
        f"ALTER TABLE reviews ADD COLUMN {ck}target VARCHAR DEFAULT 'specialist'",
        f"ALTER TABLE users ADD COLUMN {ck}response_credits INTEGER DEFAULT 5",
        f"ALTER TABLE users ADD COLUMN {ck}is_pro BOOLEAN DEFAULT false",
        f"ALTER TABLE users ADD COLUMN {ck}pro_until VARCHAR",
    ]
    for m in migrations:
        with engine.connect() as conn:
            try:
                conn.execute(text(m))
                conn.commit()
            except Exception:
                conn.rollback()

_run_column_migrations()

app = FastAPI(
    title="Marketplace Platform API",
    description="API для платформы поиска специалистов и заказчиков «ДЕЛО»",
    version="2.0.0"
)

# CORS middleware - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r".*",
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

@app.get("/")
def root():
    return {
        "status": "online",
        "app": "Marketplace Platform API",
        "version": "2.0.0",
        "docs": "/docs"
    }

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
