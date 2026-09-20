"""
Async email tasks using Celery.

Отправка email в фоне для избежания блокировки HTTP запросов.

ВНИМАНИЕ: ни одну из этих задач сейчас никто не ставит в очередь. Письмо о
сбросе пароля `POST /auth/forgot-password` отправляет синхронно, через
`app.core.email.send_email_sync`, потому что фоновой отправке нужен живой
брокер, а запрос на сброс пароля не должен падать от недоступного Redis.
Задачи оставлены как готовый путь для рассылок (`send_bulk_emails`) и
уведомлений; перед использованием их нужно подключить в вызывающем коде.
"""
import os
from app.core.celery_app import celery_app
from app.core.email import EmailNotConfigured, send_email_sync
from app.core.logging import logger


@celery_app.task(
    name='app.tasks.email.send_email',
    bind=True,
    max_retries=3,
    default_retry_delay=60  # 1 минута между retry
)
def send_email_task(self, to: str, subject: str, body: str):
    """
    Celery task для отправки email.

    Args:
        to: Email получателя
        subject: Тема письма
        body: Текст письма (plain text)

    Returns:
        dict: {"status": "sent", "to": email} или {"status": "not_configured"}

    Usage:
        # Из кода FastAPI:
        from app.tasks.email import send_email_task
        send_email_task.delay("user@example.com", "Subject", "Body")
    """
    try:
        send_email_sync(to, subject, body)
        logger.info(f"Email sent to {to}: {subject}")
        return {"status": "sent", "to": to, "subject": subject}

    except EmailNotConfigured as exc:
        # Ретраить нечего: переменной окружения от повторной попытки не
        # появится. Раньше этот случай уходил в общий `except` и задача
        # трижды ждала минуту, а потом падала — вместо того чтобы сразу
        # сказать, что SMTP не настроен.
        logger.error(f"SMTP not configured, письмо не отправлено ({to}): {exc}")
        return {"status": "not_configured", "to": to, "subject": subject}

    except Exception as exc:
        logger.error(f"Failed to send email to {to}: {exc}")
        # Retry с exponential backoff
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))


@celery_app.task(name='app.tasks.email.send_password_reset')
def send_password_reset_email(email: str, token: str):
    """
    Специализированная задача для отправки письма сброса пароля.

    Args:
        email: Email пользователя
        token: Reset token

    Usage:
        send_password_reset_email.delay("user@example.com", "token123")
    """
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    link = f"{frontend_url}/reset?token={token}"

    subject = "ДЕЛО — сброс пароля"
    body = (
        f"Здравствуйте!\n\n"
        f"Кто-то запросил сброс пароля на маркетплейсе ДЕЛО.\n"
        f"Ссылка действительна 1 час:\n\n"
        f"{link}\n\n"
        f"Если вы не запрашивали сброс — просто проигнорируйте это письмо."
    )

    return send_email_task.delay(email, subject, body)


@celery_app.task(name='app.tasks.email.send_notification_email')
def send_notification_email(email: str, title: str, text: str, task_id: int = None):
    """
    Отправка уведомления на email (для важных событий).

    Args:
        email: Email пользователя
        title: Заголовок уведомления
        text: Текст уведомления
        task_id: ID задачи (опционально)

    Usage:
        send_notification_email.delay(
            "user@example.com",
            "Вас выбрали исполнителем!",
            "Заказчик назначил вас на задачу..."
        )
    """
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    task_link = f"{frontend_url}/tasks/{task_id}" if task_id else frontend_url

    subject = f"ДЕЛО — {title}"
    body = (
        f"{text}\n\n"
        f"Перейти к заказу: {task_link}\n\n"
        f"---\n"
        f"Это автоматическое уведомление от платформы ДЕЛО.\n"
        f"Настроить уведомления: {frontend_url}/settings"
    )

    return send_email_task.delay(email, subject, body)


# Bulk email task для рассылок (использовать осторожно)
@celery_app.task(
    name='app.tasks.email.send_bulk_emails',
    rate_limit='10/m'  # Не более 10 писем в минуту для защиты от спама
)
def send_bulk_emails(recipients: list, subject: str, body: str):
    """
    Отправка массовых писем (для анонсов, новостей).

    Args:
        recipients: Список email адресов
        subject: Тема письма
        body: Текст письма

    Returns:
        dict: {"sent": count, "failed": count}

    ВАЖНО: Используйте только для важных анонсов с разрешения пользователей.
    """
    results = {"sent": 0, "failed": 0}

    for email in recipients:
        try:
            send_email_sync(email, subject, body)
            results["sent"] += 1
        except Exception as e:
            logger.error(f"Failed to send bulk email to {email}: {e}")
            results["failed"] += 1

    logger.info(f"Bulk email sent: {results}")
    return results
