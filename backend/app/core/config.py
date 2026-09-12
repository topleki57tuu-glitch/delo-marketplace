import os
from typing import List


def _parse_origins(raw: str) -> List[str]:
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


class Settings:
    ENV: str = os.environ.get("ENV", "development").lower()
    IS_PRODUCTION: bool = ENV == "production"

    ALGORITHM: str = "HS256"
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "")

    DB_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./marketplace_v3.db")

    # Process DB_URL for SQLAlchemy 2.0
    if DB_URL.startswith("postgres://"):
        DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)
    elif DB_URL.startswith("postgresql://"):
        DB_URL = DB_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

    if not SECRET_KEY and IS_PRODUCTION:
        # Раньше здесь молча подставлялся захардкоженный ключ — любой знающий код
        # мог подделать JWT. В production отказываемся стартовать без секрета.
        raise RuntimeError(
            "SECRET_KEY is not set: в production обязательна переменная окружения "
            "SECRET_KEY со случайным значением (см. .env.example)"
        )
    if not SECRET_KEY:
        # Известный dev-ключ — только для локальной разработки
        SECRET_KEY = "marketplace_super_secret"

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
