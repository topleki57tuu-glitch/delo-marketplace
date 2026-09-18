import os
from typing import List
from dotenv import load_dotenv

# Загрузка переменных из .env файла
load_dotenv()

# Каталог backend/ — якорь для относительных путей к файлам (SQLite и пр.).
# Без этого "sqlite:///./marketplace_v3.db" резолвится относительно текущей
# рабочей директории процесса: запуск `python backend/seed_demo.py` из корня
# создавал БД в корне, а uvicorn из backend/ читал другую базу — сервер и
# seed молча работали с разными данными.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _absolutize_sqlite(url: str) -> str:
    """Прибивает относительный sqlite-путь к каталогу backend/."""
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    path = url[len(prefix):]
    if not path or path == ":memory:" or os.path.isabs(path):
        return url
    return prefix + os.path.normpath(os.path.join(BACKEND_DIR, path))


def _parse_origins(raw: str) -> List[str]:
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


class Settings:
    # Определение окружения — fail-closed.
    #
    # Раньше было `IS_PRODUCTION = (ENV == "production")` при дефолте
    # ENV=development. Это опасный дефолт: забыв выставить ENV на боевом
    # контуре, получаешь выключенные CSRF и rate-limit, сгенерированный
    # SECRET_KEY и разрешённое демо-пополнение кошелька — то есть приложение
    # молча работает в небезопасном режиме вместо того, чтобы упасть.
    #
    # Теперь наоборот: прод — режим по умолчанию, а dev включается только
    # явным ENV=development. Ошибка в сторону «приложение не стартовало»
    # вместо «приложение работает без защиты». Требовать явности для
    # production всё равно не нужно: без SECRET_KEY и CORS_ORIGINS оно
    # не поднимется, и это правильный отказ.
    _ENV_RAW: str = os.environ.get("ENV", "").strip().lower()
    ENV: str = _ENV_RAW or "production"
    IS_PRODUCTION: bool = ENV != "development"

    ALGORITHM: str = "HS256"
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "")

    DB_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./marketplace_v3.db")

    # Process DB_URL for SQLAlchemy 2.0
    if DB_URL.startswith("postgres://"):
        DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)
    elif DB_URL.startswith("postgresql://"):
        DB_URL = DB_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

    # Относительный sqlite-путь всегда считаем от backend/, а не от CWD.
    DB_URL = _absolutize_sqlite(DB_URL)

    if not SECRET_KEY:
        if IS_PRODUCTION:
            # В production отказываемся стартовать без секрета
            raise RuntimeError(
                "SECRET_KEY is not set: в production обязательна переменная окружения "
                "SECRET_KEY со случайным значением (см. .env.example)"
            )
        # В development генерируем случайный ключ при каждом запуске — безопаснее,
        # чем известный всем "marketplace_super_secret". Токены инвалидируются при
        # перезапуске, но это приемлемо для локальной разработки.
        import secrets
        SECRET_KEY = secrets.token_urlsafe(48)
        print(f"[security] Generated random SECRET_KEY for development: {SECRET_KEY[:20]}...")

    FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "").rstrip("/")
    CORS_ORIGINS: List[str] = _parse_origins(os.environ.get("CORS_ORIGINS", ""))

    # Лимиты запросов. В проде включены всегда; в разработке по умолчанию
    # выключены, но их можно включить (RATE_LIMIT_ENABLED=1) — иначе защита
    # от перебора паролей никогда не проверяется до самого релиза.
    _rl_raw: str = os.environ.get("RATE_LIMIT_ENABLED", "")
    RATE_LIMIT_ENABLED: bool = (
        IS_PRODUCTION if _rl_raw == "" else _rl_raw.strip().lower() in ("1", "true", "yes", "on")
    )

    # Общий счётчик лимитов. Без него лимиты считаются в памяти процесса
    # и не разделяются между воркерами — реальный порог умножается на их число.
    REDIS_URL: str = os.environ.get("REDIS_URL", "")

    # CSRF защита. В проде включена всегда; в разработке по умолчанию
    # выключена для удобства тестирования, но можно включить (CSRF_ENABLED=1).
    _csrf_raw: str = os.environ.get("CSRF_ENABLED", "")
    CSRF_ENABLED: bool = (
        IS_PRODUCTION if _csrf_raw == "" else _csrf_raw.strip().lower() in ("1", "true", "yes", "on")
    )

    # Флаг Secure у cookie. Раньше он молча выводился из IS_PRODUCTION, из-за
    # чего на окружении с ENV=production, но без HTTPS (CI, локальный прогон
    # боевого профиля, отладка за прокси без TLS) браузер отбрасывал cookie
    # с CSRF — все изменяющие запросы падали с 403 «токен отсутствует».
    # Теперь связь с HTTPS задаётся явно: COOKIE_SECURE=1/0, иначе — по ENV.
    _cookie_secure_raw: str = os.environ.get("COOKIE_SECURE", "")
    COOKIE_SECURE: bool = (
        IS_PRODUCTION
        if _cookie_secure_raw == ""
        else _cookie_secure_raw.strip().lower() in ("1", "true", "yes", "on")
    )

    # Sentry для мониторинга ошибок в production
    SENTRY_DSN: str = os.environ.get("SENTRY_DSN", "")
    SENTRY_ENVIRONMENT: str = os.environ.get("SENTRY_ENVIRONMENT", ENV)
    SENTRY_TRACES_SAMPLE_RATE: float = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))

    if not CORS_ORIGINS:
        if IS_PRODUCTION:
            if FRONTEND_URL:
                CORS_ORIGINS = [FRONTEND_URL]
            else:
                raise RuntimeError(
                    "CORS_ORIGINS не задан: в production укажите список разрешённых "
                    "источников через запятую (или FRONTEND_URL) — см. .env.example"
                )
        else:
            CORS_ORIGINS = [
                "http://localhost:3000",
                "http://localhost:5173",
                "http://localhost",
                "http://localhost:80",
            ]
            if FRONTEND_URL:
                CORS_ORIGINS.append(FRONTEND_URL)

settings = Settings()
