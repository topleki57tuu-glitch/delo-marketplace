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
from urllib.parse import urlsplit, urlunsplit

from celery import Celery
from celery.schedules import crontab
from app.core.logging import logger

# Redis URL для broker и backend.
#
# Broker и результаты живут в РАЗНЫХ базах того же Redis, чтобы задачи не
# смешивались с кэшем приложения (`/0`).
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def _redis_db(url: str, db: int) -> str:
    """Тот же Redis, но с другим номером базы.

    Номер базы **заменяется**, а не дописывается — и это не придирка к стилю.
    Раньше здесь стояло `f"{REDIS_URL}/1"`, а `REDIS_URL` в контуре по умолчанию
    уже содержит базу: `redis://redis:6379/0` (см. docker-compose.prod.yml,
    render.yaml и ci.yml). Конкатенация давала `redis://redis:6379/0/1`, kombu
    разбирал хвост как имя базы (`virtual_host = "0/1"`), а `int("0/1")` падал:

        ValueError: invalid literal for int() with base 10: '0/1'

    Причём падало это не при старте и не при запуске воркера, а при первой же
    отправке задачи — то есть подсистема выглядела рабочей ровно до того
    момента, когда её впервые пытались использовать. Ни один контур воркер не
    поднимал, поэтому дефект и не всплывал.
    """
    parts = urlsplit(url)
    if not parts.scheme:
        return url
    return urlunsplit((parts.scheme, parts.netloc, f"/{db}", parts.query, parts.fragment))


# Явно заданные адреса уважаем: через них подключают внешний брокер.
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL") or _redis_db(REDIS_URL, 1)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND") or _redis_db(REDIS_URL, 2)

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
    #
    # Здесь перечислены ВСЕ задачи, которые должны идти по расписанию. Список
    # раньше не совпадал с набором задач: `cleanup_expired_password_reset_tokens`
    # и `cleanup_expired_refresh_tokens` существовали, работали и не запускались
    # никем — ни по расписанию, ни по вызову из кода. Истёкшие токены сброса
    # пароля и refresh-токены накапливались в таблицах бессрочно.
    #
    # Две задачи в расписании СОЗНАТЕЛЬНО не стоят — и это решение, а не
    # забывчивость, поэтому оно записано здесь, а не подразумевается:
    #
    # `cleanup_orphaned_files` — удаляет данные. По таймеру без присмотра
    #   её запускать не стоит. Вызывать вручную:
    #     celery -A app.core.celery_app call app.tasks.cleanup.cleanup_orphaned_files
    #   Регресс — tests/security/check_file_cleanup.py.
    #
    # `vacuum_database` — на PostgreSQL пропускается сама (там autovacuum, а
    #   VACUUM в транзакции запрещён), а на SQLite берёт эксклюзивную блокировку
    #   на всё время работы, то есть на живой базе это отказ в обслуживании на
    #   минуты. В боевом контуре СУБД — PostgreSQL, поэтому по расписанию она
    #   не нужна ни там, ни здесь.
    #
    # Список «вне расписания» сверяется с кодом в
    # tests/security/check_celery_tasks.py: задача, выпавшая из расписания
    # случайно, попадает в отчёт как забытая.
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
        # Истёкшие токены сброса пароля — раз в сутки в 3:30
        'cleanup-password-reset-tokens': {
            'task': 'app.tasks.cleanup.cleanup_expired_password_reset_tokens',
            'schedule': crontab(hour=3, minute=30),
        },
        # Истёкшие refresh-токены — раз в сутки в 4:00
        'cleanup-refresh-tokens': {
            'task': 'app.tasks.cleanup.cleanup_expired_refresh_tokens',
            'schedule': crontab(hour=4, minute=0),
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
