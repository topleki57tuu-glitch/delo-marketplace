"""
Redis кеширование для высоконагруженных эндпоинтов.

Используется для кеширования списка открытых задач на 1 минуту,
что снижает нагрузку на БД при частых обращениях на главную страницу.
"""
import json
import os
from typing import Optional, Any
from datetime import timedelta

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

from app.core.logging import logger


class CacheClient:
    """Redis клиент с fallback если Redis недоступен."""

    def __init__(self):
        self.client: Optional[Any] = None
        self.enabled = False

        if not REDIS_AVAILABLE:
            logger.info("Redis not installed, caching disabled")
            return

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

        try:
            self.client = redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2)
            # Проверяем подключение
            self.client.ping()
            self.enabled = True
            logger.info(f"Redis connected: {redis_url}")
        except Exception as e:
            logger.warning(f"Redis unavailable, caching disabled: {e}")
            self.client = None
            self.enabled = False

    def get(self, key: str) -> Optional[str]:
        """Получить значение из кеша."""
        if not self.enabled or not self.client:
            return None

        try:
            return self.client.get(key)
        except Exception as e:
            logger.warning(f"Redis get error: {e}")
            return None

    def set(self, key: str, value: str, ttl_seconds: int = 60) -> bool:
        """Сохранить значение в кеш с TTL."""
        if not self.enabled or not self.client:
            return False

        try:
            self.client.setex(key, ttl_seconds, value)
            return True
        except Exception as e:
            logger.warning(f"Redis set error: {e}")
            return False

    def delete(self, key: str) -> bool:
        """Удалить ключ из кеша."""
        if not self.enabled or not self.client:
            return False

        try:
            self.client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Redis delete error: {e}")
            return False

    def invalidate_pattern(self, pattern: str) -> int:
        """Удалить все ключи по паттерну (например, tasks:*)."""
        if not self.enabled or not self.client:
            return 0

        try:
            keys = self.client.keys(pattern)
            if keys:
                return self.client.delete(*keys)
            return 0
        except Exception as e:
            logger.warning(f"Redis invalidate pattern error: {e}")
            return 0


# Глобальный singleton
cache = CacheClient()


def cache_json(key: str, ttl_seconds: int = 60):
    """Декоратор для кеширования JSON результата функции.

    Usage:
        @cache_json("tasks:open", ttl_seconds=60)
        def get_open_tasks():
            return db.query(Task).filter(...).all()
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            # Пропускаем кеш если disabled
            if not cache.enabled:
                return func(*args, **kwargs)

            # Проверяем кеш
            cached = cache.get(key)
            if cached:
                try:
                    logger.debug(f"Cache HIT: {key}")
                    return json.loads(cached)
                except json.JSONDecodeError:
                    logger.warning(f"Cache decode error for {key}")

            # Кеш промах - вызываем функцию
            logger.debug(f"Cache MISS: {key}")
            result = func(*args, **kwargs)

            # Сохраняем в кеш
            try:
                cache.set(key, json.dumps(result, default=str), ttl_seconds)
            except (TypeError, ValueError) as e:
                logger.warning(f"Cache serialization error: {e}")

            return result
        return wrapper
    return decorator
