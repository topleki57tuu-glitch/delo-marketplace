"""
Celery configuration for async tasks.

Используется для длительных операций:
- Отправка email (forgot password, notifications)
- Обработка изображений (resize, thumbnails)
- Генерация отчетов
- Scheduled tasks (cleanup, analytics)

Setup:
    pip install celery redis

Run worker:
    celery -A app.core.celery_app worker --loglevel=info

Run beat (scheduled tasks):
    celery -A app.core.celery_app beat --loglevel=info
"""
import os
from celery import Celery
from celery.schedules import crontab
from app.core.logging import logger

# Redis URL для broker и backend
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", f"{REDIS_URL}/1")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", f"{REDIS_URL}/2")

# Создаем Celery app
celery_app = Celery(
    "delo_marketplace",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=['app.tasks.email', 'app.tasks.cleanup']  # Модули с тасками
)

# Конфигурация
celery_app.conf.update(
    # Таймзона
    timezone='UTC',
    enable_utc=True,

    # Результаты задач хранятся 1 час
    result_expires=3600,

    # Сериализация
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',

    # Retry настройки
    task_acks_late=True,  # Ack после выполнения
    task_reject_on_worker_lost=True,  # Retry если worker упал

    # Worker настройки
    worker_prefetch_multiplier=4,  # Сколько задач prefetch-ить
    worker_max_tasks_per_child=1000,  # Перезапуск worker после N задач (защита от memory leaks)

    # Scheduled tasks (Celery Beat)
    beat_schedule={
        # Очистка старых уведомлений каждую ночь в 3:00
        'cleanup-old-notifications': {
            'task': 'app.tasks.cleanup.cleanup_old_notifications',
            'schedule': crontab(hour=3, minute=0),
        },
        # Очистка истекших CSRF токенов каждый час
        'cleanup-expired-csrf': {
            'task': 'app.tasks.cleanup.cleanup_expired_csrf_tokens',
            'schedule': crontab(minute=0),  # Каждый час
        },
        # Проверка истекших PRO подписок каждый день в 9:00
        'check-expired-pro': {
            'task': 'app.tasks.cleanup.check_expired_pro_subscriptions',
            'schedule': crontab(hour=9, minute=0),
        },
    },
)

# Graceful shutdown
celery_app.conf.task_soft_time_limit = 300  # 5 минут soft limit
celery_app.conf.task_time_limit = 600  # 10 минут hard limit

logger.info(f"Celery configured | broker={CELERY_BROKER_URL} | backend={CELERY_RESULT_BACKEND}")


# Health check task
@celery_app.task(name='celery.ping')
def celery_ping():
    """Health check для Celery worker."""
    return 'pong'
