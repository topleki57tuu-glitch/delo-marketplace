"""
Cleanup and maintenance tasks.

Периодические задачи для поддержания чистоты БД и оптимальной производительности.
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.core.celery_app import celery_app
from app.core.database import SessionLocal, engine
from app.core.logging import logger
from app.models import Notification, PasswordResetToken, RefreshToken, User


@celery_app.task(name='app.tasks.cleanup.cleanup_old_notifications')
def cleanup_old_notifications(days_old: int = 30):
    """
    Удаляет прочитанные уведомления старше N дней.

    Args:
        days_old: Возраст уведомлений в днях (по умолчанию 30)

    Returns:
        dict: {"deleted": count}

    Scheduled: каждую ночь в 3:00
    """
    db: Session = SessionLocal()
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days_old)

        # Колонка называется `is_read`. Здесь стояло `Notification.read`,
        # и задача падала с `AttributeError` на каждом запуске: обращение
        # к несуществующему атрибуту происходит при построении запроса,
        # ещё до базы. Так как воркер не поднимался нигде, падение никто
        # не видел — но починить его надо было ДО того, как поднимать воркер,
        # иначе он начал бы с ежедневной ошибки в логе и нуля удалений.
        deleted = db.query(Notification).filter(
            Notification.is_read == True,  # noqa: E712
            Notification.created_at < cutoff_date
        ).delete()

        db.commit()
        logger.info(f"Cleaned up {deleted} old notifications (>{days_old} days)")
        return {"deleted": deleted, "days_old": days_old}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to cleanup notifications: {e}")
        raise
    finally:
        db.close()


@celery_app.task(name='app.tasks.cleanup.cleanup_expired_csrf_tokens')
def cleanup_expired_csrf_tokens():
    """
    Очистка истекших CSRF токенов из кеша.

    Если используется in-memory store, эта задача не требуется.
    Для Redis - удаляет expired ключи.

    Scheduled: каждый час
    """
    try:
        from app.core.cache import cache

        if not cache.enabled:
            return {"status": "skipped", "reason": "cache disabled"}

        # Redis автоматически удаляет expired ключи, но можно форсировать
        deleted = cache.invalidate_pattern("csrf:*")

        logger.info(f"Cleaned up {deleted} CSRF tokens")
        return {"deleted": deleted}

    except Exception as e:
        logger.error(f"Failed to cleanup CSRF tokens: {e}")
        raise


@celery_app.task(name='app.tasks.cleanup.cleanup_expired_password_reset_tokens')
def cleanup_expired_password_reset_tokens():
    """
    Удаляет истекшие токены сброса пароля (>24 часа).

    Returns:
        dict: {"deleted": count}

    Scheduled: ежедневно
    """
    db: Session = SessionLocal()
    try:
        cutoff_date = datetime.utcnow() - timedelta(hours=24)

        deleted = db.query(PasswordResetToken).filter(
            PasswordResetToken.expires_at < cutoff_date
        ).delete()

        db.commit()
        logger.info(f"Cleaned up {deleted} expired password reset tokens")
        return {"deleted": deleted}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to cleanup password reset tokens: {e}")
        raise
    finally:
        db.close()


@celery_app.task(name='app.tasks.cleanup.cleanup_expired_refresh_tokens')
def cleanup_expired_refresh_tokens():
    """
    Удаляет истекшие refresh токены (>7 дней).

    Returns:
        dict: {"deleted": count}

    Scheduled: ежедневно
    """
    db: Session = SessionLocal()
    try:
        cutoff_date = datetime.utcnow()

        deleted = db.query(RefreshToken).filter(
            RefreshToken.expires_at < cutoff_date
        ).delete()

        db.commit()
        logger.info(f"Cleaned up {deleted} expired refresh tokens")
        return {"deleted": deleted}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to cleanup refresh tokens: {e}")
        raise
    finally:
        db.close()


@celery_app.task(name='app.tasks.cleanup.check_expired_pro_subscriptions')
def check_expired_pro_subscriptions():
    """
    Проверяет и отключает истекшие PRO подписки.

    Находит пользователей с is_pro=True и pro_until < now,
    отключает PRO статус.

    Returns:
        dict: {"expired": count}

    Scheduled: каждый день в 9:00
    """
    db: Session = SessionLocal()
    try:
        now = datetime.utcnow()

        expired_users = db.query(User).filter(
            User.is_pro == True,
            User.pro_until < now
        ).all()

        count = 0
        for user in expired_users:
            user.is_pro = False
            count += 1
            logger.info(f"PRO subscription expired for user {user.id}")

        db.commit()
        logger.info(f"Disabled {count} expired PRO subscriptions")
        return {"expired": count}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to check expired PRO subscriptions: {e}")
        raise
    finally:
        db.close()


@celery_app.task(name='app.tasks.cleanup.vacuum_database')
def vacuum_database():
    """Дефрагментирует базу данных SQLite.

    Returns:
        dict: {"status": "completed"} либо {"status": "skipped", "reason": ...}

    ВНИМАНИЕ: Может занять несколько минут для больших БД.
    """
    from sqlalchemy import text

    if engine.dialect.name != "sqlite":
        # На PostgreSQL VACUUM внутри транзакции запрещён, а обслуживанием
        # занимается autovacuum — запускать это вручную не нужно и вредно
        # (блокировка на минуты). Раньше задача пыталась выполниться на любой
        # СУБД, но до этого дело не доходило: она падала и на SQLite.
        logger.info("vacuum_database: пропуск для %s (autovacuum)", engine.dialect.name)
        return {"status": "skipped", "reason": f"{engine.dialect.name}: autovacuum"}

    # VACUUM нельзя выполнить внутри транзакции, поэтому берём соединение
    # в режиме AUTOCOMMIT.
    #
    # Раньше здесь стояло `db.execute("VACUUM")` и ручная правка
    # `isolation_level` у сырого соединения. В SQLAlchemy 2.0 голая строка —
    # не исполняемое выражение, и задача падала с
    #
    #   ObjectNotExecutableError: Not an executable object: 'VACUUM'
    #
    # (подкласс `ArgumentError`; на SQLAlchemy 2.0.46 класс именно такой).
    # То есть не работала ни разу за всё время существования.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("VACUUM"))

    logger.info("Database VACUUM completed")
    return {"status": "completed"}


@celery_app.task(name='app.tasks.cleanup.cleanup_orphaned_files')
def cleanup_orphaned_files(days_old: int = 7):
    """Удаляет записи о файлах, на которые никто не ссылается.

    Сама логика — в `app/core/file_cleanup.py`: этот модуль на верхнем уровне
    импортирует celery, которого нет в зависимостях, поэтому держать здесь
    код, удаляющий данные, означало бы держать его непроверяемым.
    """
    from app.core.file_cleanup import sweep_orphaned_files

    db: Session = SessionLocal()
    try:
        result = sweep_orphaned_files(db, days_old=days_old)
        db.commit()
        logger.info(
            f"cleanup_orphaned_files: ссылок найдено {result['referenced']}, "
            f"удалено записей {result['deleted']}"
        )
        return result
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to cleanup orphaned files: {e}")
        raise
    finally:
        db.close()
