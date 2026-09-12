"""
Dependency Injection контейнер для приложения.

Централизует создание и управление зависимостями:
- Database sessions
- Services
- Repositories
- External clients

Преимущества:
- Упрощает тестирование (можно легко мокировать зависимости)
- Централизованная конфигурация
- Явные зависимости
"""
from typing import Generator, Optional
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.config import settings
import redis


class Container:
    """DI контейнер приложения."""

    def __init__(self):
        self._redis_client: Optional[redis.Redis] = None

    # Database
    def get_db(self) -> Generator[Session, None, None]:
        """Создаёт database session.

        Используется как FastAPI dependency:
        @router.get("/")
        def endpoint(db: Session = Depends(container.get_db)):
            ...
        """
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    # Redis
    def get_redis(self) -> Optional[redis.Redis]:
        """Возвращает Redis клиент (singleton).

        Используется для rate limiting и кеширования.
        """
        if self._redis_client is None and settings.REDIS_URL:
            try:
                self._redis_client = redis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    socket_timeout=2,
                    socket_connect_timeout=2
                )
                # Проверяем соединение
                self._redis_client.ping()
            except Exception:
                self._redis_client = None
        return self._redis_client

    # Services (можно добавить по мере необходимости)
    # def get_email_service(self) -> EmailService:
    #     return EmailService(
    #         smtp_host=settings.SMTP_HOST,
    #         smtp_port=settings.SMTP_PORT,
    #         smtp_user=settings.SMTP_USER,
    #         smtp_pass=settings.SMTP_PASS
    #     )

    # def get_payment_service(self) -> PaymentService:
    #     return PaymentService(
    #         api_key=settings.YOOKASSA_SECRET_KEY,
    #         shop_id=settings.YOOKASSA_SHOP_ID
    #     )


# Singleton экземпляр контейнера
container = Container()


# Экспортируем get_db для обратной совместимости
def get_db() -> Generator[Session, None, None]:
    """Database dependency для FastAPI."""
    yield from container.get_db()
