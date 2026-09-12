"""
Celery tasks module.

Содержит асинхронные задачи для:
- Email отправка (email.py)
- Cleanup и maintenance (cleanup.py)
"""
from app.tasks.email import (
    send_email_task,
    send_password_reset_email,
    send_notification_email,
    send_bulk_emails
)
from app.tasks.cleanup import (
    cleanup_old_notifications,
    cleanup_expired_csrf_tokens,
    cleanup_expired_password_reset_tokens,
    cleanup_expired_refresh_tokens,
    check_expired_pro_subscriptions,
    vacuum_database,
    cleanup_orphaned_files
)

__all__ = [
    # Email tasks
    'send_email_task',
    'send_password_reset_email',
    'send_notification_email',
    'send_bulk_emails',
    # Cleanup tasks
    'cleanup_old_notifications',
    'cleanup_expired_csrf_tokens',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_refresh_tokens',
    'check_expired_pro_subscriptions',
    'vacuum_database',
    'cleanup_orphaned_files',
]
