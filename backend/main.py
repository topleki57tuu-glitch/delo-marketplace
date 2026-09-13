from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse as FastResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os
import json
import time
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.core.csrf import generate_csrf_token, set_csrf_cookie
from app.core.logging import logger, log_request
from app.core.monitoring import setup_query_monitoring, get_connection_pool_status
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

# Инициализируем Sentry для мониторинга ошибок в production
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
        # Включаем отправку PII (user_id) для контекста ошибок
        send_default_pii=True,
    )
    logger.info(f"Sentry initialized | environment={settings.SENTRY_ENVIRONMENT} | sample_rate={settings.SENTRY_TRACES_SAMPLE_RATE}")

# Инициализируем логирование при старте
logger.info(f"Starting DELO Marketplace API | ENV={settings.ENV} | CSRF={settings.CSRF_ENABLED} | RATE_LIMIT={settings.RATE_LIMIT_ENABLED}")

# Setup query monitoring for slow queries (>100ms)
if settings.ENV == "production" or os.getenv("ENABLE_QUERY_MONITORING", "").lower() in ("1", "true"):
    setup_query_monitoring(slow_query_threshold_ms=100)
    logger.info("Query monitoring enabled (threshold: 100ms)")

# Initialize Database tables
# ВАЖНО: В production используйте Alembic миграции вместо create_all
# create_all() создаёт таблицы, но не обновляет существующие
if settings.ENV == "development":
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created (development mode)")
else:
    # В production ожидаем, что миграции применены вручную через Alembic
    logger.info("Production mode: ensure Alembic migrations are applied")

# Для развёртывания «из коробки»: если выставлен SEED_DEMO=1 и база пустая,
# засеиваем демо-данные. В обычной разработке выключено.
if os.environ.get("SEED_DEMO", "").lower() in ("1", "true", "yes"):
    try:
        from sqlalchemy import func as _func
        with SessionLocal() as _db:
            if (_db.query(_func.count(User.id)).scalar() or 0) == 0:
                from seed_demo import main as _seed_main
                _seed_main()
                logger.info("Database seeded with demo data")
    except Exception as _exc:
        logger.error(f"Failed to seed demo data: {_exc}")

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
async def log_requests(request: Request, call_next):
    """Логирует все HTTP запросы с временем выполнения."""
    start_time = time.time()

    # Извлекаем user_id из JWT если есть
    user_id = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = jwt.decode(auth_header[7:], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            user_id = int(payload.get("sub", 0))
        except Exception:
            pass

    response = await call_next(request)

    duration_ms = (time.time() - start_time) * 1000
    client_ip = request.client.host if request.client else "unknown"

    # Логируем все запросы кроме health check и статики
    if not request.url.path.startswith(("/health", "/assets", "/uploads")):
        log_request(
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            user_id=user_id,
            ip=client_ip
        )

    return response

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # Content Security Policy (CSP) — защита от XSS и injection атак
    # Разрешаем загрузку ресурсов только из доверенных источников
    csp_directives = [
        "default-src 'self'",  # По умолчанию только свой домен
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  # React требует unsafe для dev
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  # Стили + Google Fonts
        "font-src 'self' https://fonts.gstatic.com",  # Шрифты
        "img-src 'self' data: https:",  # Изображения (data: для base64, https: для CDN)
        "connect-src 'self' https://sentry.io",  # API запросы + Sentry
        "frame-ancestors 'none'",  # Запрещает iframe (дублирует X-Frame-Options)
        "base-uri 'self'",  # Ограничивает <base> tag
        "form-action 'self'",  # Формы только на свой домен
    ]

    # В production ужесточаем CSP (убираем unsafe-*)
    if settings.IS_PRODUCTION:
        csp_directives[1] = "script-src 'self'"  # Без unsafe-inline/eval

    response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

    return response

@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    """Ограничение размера загружаемых файлов на уровне middleware.

    Проверяем Content-Length ДО чтения тела запроса, чтобы отклонить
    слишком большие файлы без загрузки их в память — защита от DoS.
    """
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_UPLOAD_SIZE:
        return FastResponse(
            status_code=413,
            content=json.dumps({
                "detail": f"Файл слишком большой. Максимум: {MAX_UPLOAD_SIZE // (1024*1024)} MB"
            }),
            media_type="application/json"
        )

    return await call_next(request)

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
            now = datetime.now(timezone.utc)
            last = _seen_cache.get(uid)
            if last is None or (now - last).total_seconds() > 60:
                db = SessionLocal()
                try:
                    # FIX: Передаём datetime объект вместо строки для совместимости с Column(DateTime)
                    db.query(User).filter(User.id == uid).update({"last_seen": now})
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
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/health/db")
def health_db():
    """Database health check with connection pool status.

    Useful for monitoring and alerting on database connection issues.
    """
    try:
        pool_status = get_connection_pool_status(engine)
        # Simple query to verify DB connectivity
        with SessionLocal() as db:
            db.execute("SELECT 1")

        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "database": "connected",
            "pool": pool_status
        }
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return FastResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "error": str(e)
            }
        )

@app.get("/csrf-token")
def get_csrf_token(response: Response):
    """Выдаёт CSRF токен для клиента.

    SPA вызывает этот эндпоинт при загрузке, сохраняет токен в localStorage
    и отправляет в заголовке X-CSRF-Token при каждом state-changing запросе.
    Токен также записывается в signed httpOnly cookie для проверки.
    """
    token = generate_csrf_token()
    set_csrf_cookie(response, token)
    return {"csrf_token": token}


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
