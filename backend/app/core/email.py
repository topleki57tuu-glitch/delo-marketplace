"""Отправка почты — одна реализация на весь проект.

Раньше SMTP-клиент существовал в двух копиях: `app/api/auth.py` (для письма о
сбросе пароля) и `app/tasks/email.py` (для фоновых задач). Копии совпадали
почти дословно и различались только типом исключения при ненастроенном SMTP —
`HTTPException(503)` в одном месте и `Exception` в другом. Это ровно тот класс
дефектов, который в этом проекте уже приводил к расхождению: две копии
`user_online` разошлись и обе перестали работать, а `hasattr(x, "value")` был
скопирован 23 раза.

Почему транспорт лежит в `app/core`, а не в `app/tasks`:
`app/tasks/email.py` на верхнем уровне импортирует `celery`. Если бы
`app/api/auth.py` брал функцию оттуда, API-процесс тянул бы за собой Celery
ради одной функции отправки письма. Здесь зависимость односторонняя: задачи
импортируют транспорт, транспорт не знает ни о задачах, ни о Celery.
"""
import os
import smtplib
from email.mime.text import MIMEText


class EmailNotConfigured(RuntimeError):
    """SMTP не настроен.

    Отдельный тип нужен, чтобы отличить «повторять бессмысленно» от «сервер
    отвалился, попробуй ещё». Фоновая задача ретраит второе и не ретраит
    первое: три попытки с экспоненциальной задержкой против незаданной
    переменной окружения — это только шум в логе и занятая очередь.
    """


def smtp_settings() -> dict:
    """Настройки SMTP из окружения. Пустые строки, если не заданы."""
    return {
        "host": os.environ.get("SMTP_HOST"),
        "user": os.environ.get("SMTP_USER"),
        "password": os.environ.get("SMTP_PASS"),
        "sender": os.environ.get("SMTP_FROM"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
    }


def send_email_sync(to: str, subject: str, body: str) -> None:
    """Отправить письмо синхронно.

    Raises:
        EmailNotConfigured: если SMTP_HOST/SMTP_USER/SMTP_PASS не заданы.
        Exception: если отправка не удалась (сеть, аутентификация, TLS).
    """
    conf = smtp_settings()

    if not conf["host"] or not conf["user"] or not conf["password"]:
        raise EmailNotConfigured("SMTP not configured")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = conf["sender"] or conf["user"]
    msg["To"] = to

    with smtplib.SMTP(conf["host"], conf["port"], timeout=20) as server:
        server.starttls()
        server.login(conf["user"], conf["password"])
        server.send_message(msg)
