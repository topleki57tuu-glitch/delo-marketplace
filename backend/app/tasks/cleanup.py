"""
Cleanup and maintenance tasks.

Периодические задачи для поддержания чистоты БД и оптимальной производительности.
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.core.celery_app import celery_app
from app.core.database import SessionLocal
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

        deleted = db.query(Notification).filter(
            Notification.read == True,
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
    """
    Выполняет VACUUM для SQLite (дефрагментация и освобождение места).

    Для PostgreSQL используйте VACUUM ANALYZE вместо этой задачи.

    Returns:
        dict: {"status": "completed"}

    ВНИМАНИЕ: Может занять несколько минут для больших БД.
    """
    db: Session = SessionLocal()
    try:
        # VACUUM нельзя выполнить внутри транзакции
        db.connection().connection.isolation_level = None
        db.execute("VACUUM")
        db.connection().connection.isolation_level = ""

        logger.info("Database VACUUM completed")
        return {"status": "completed"}

    except Exception as e:
        logger.error(f"Failed to VACUUM database: {e}")
        raise
    finally:
        db.close()


@celery_app.task(name='app.tasks.cleanup.cleanup_orphaned_files')
def cleanup_orphaned_files():
    """
    Удаляет файлы из uploads/, которых нет в БД.

    ВАЖНО: Будьте осторожны с этой задачей - проверьте логику перед запуском.

    Returns:
        dict: {"deleted": count}
    """
    import os
    from pathlib import Path
    from app.models import StoredFile, Task
    from file_utils import UPLOAD_DIR

    db: Session = SessionLocal()
    try:
        # Получаем все файлы из БД
        db_files = set()

        # Файлы из StoredFile
        for file in db.query(StoredFile).all():
            if file.path:
                db_files.add(file.path)

        # Изображения задач из Task.images
        for task in db.query(Task).filter(Task.images.isnot(None)).all():
            if task.images:
                import json
                try:
                    images = json.loads(task.images)
                    for img_url in images:
                        # Извлекаем путь из URL
                        if "/uploads/" in img_url:
                            path = img_url.split("/uploads/")[1]
                            db_files.add(path)
                except:
                    pass

        # Сканируем файловую систему
        deleted_count = 0
        upload_path = Path(UPLOAD_DIR)

        for file_path in upload_path.rglob("*"):
            if file_path.is_file():
                relative_path = str(file_path.relative_to(upload_path))

                # Если файла нет в БД - удаляем
                if relative_path not in db_files:
                    try:
                        file_path.unlink()
                        deleted_count += 1
                        logger.info(f"Deleted orphaned file: {relative_path}")
                    except Exception as e:
                        logger.error(f"Failed to delete {relative_path}: {e}")

        logger.info(f"Cleaned up {deleted_count} orphaned files")
        return {"deleted": deleted_count}

    except Exception as e:
        logger.error(f"Failed to cleanup orphaned files: {e}")
        raise
    finally:
        db.close()
