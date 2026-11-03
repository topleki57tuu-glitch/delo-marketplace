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
import sys
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


def email_configured() -> bool:
    """Настроена ли отправка писем (заданы SMTP_HOST, SMTP_USER и SMTP_PASS)."""
    conf = smtp_settings()
    return bool(conf["host"] and conf["user"] and conf["password"])


def send_email_sync(to: str, subject: str, body: str) -> None:
    """Отправить письмо синхронно.

    Порт 465 — сразу шифрованное соединение (SMTP_SSL), остальные (обычно
    587) — STARTTLS. Почтовые сервисы дают оба варианта, а хостинг иногда
    закрывает один из портов: так можно переключиться без правки кода.

    Raises:
        EmailNotConfigured: если SMTP_HOST/SMTP_USER/SMTP_PASS не заданы.
        Exception: если отправка не удалась (сеть, аутентификация, TLS).
    """
    conf = smtp_settings()

    if not email_configured():
        raise EmailNotConfigured("SMTP not configured")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = conf["sender"] or conf["user"]
    msg["To"] = to

    if conf["port"] == 465:
        with smtplib.SMTP_SSL(conf["host"], conf["port"], timeout=20) as server:
            server.login(conf["user"], conf["password"])
            server.send_message(msg)
        return

    with smtplib.SMTP(conf["host"], conf["port"], timeout=20) as server:
        server.starttls()
        server.login(conf["user"], conf["password"])
        server.send_message(msg)


# ---------------------------------------------------------------------------
# Проверка почты с сервера:
#
#   docker compose -f docker-compose.prod.yml exec backend \
#       python -m app.core.email --test you@example.com
#
# (или короче: bash scripts/check_email.sh you@example.com)
#
# Отправляет тестовое письмо и объясняет ошибку простыми словами. Без такой
# проверки о сломанной почте узнают от пользователей: «не приходит письмо
# для сброса пароля» или «не могу подтвердить почту».
# ---------------------------------------------------------------------------

def _explain_failure(exc: BaseException, port: int) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return (
            "Почтовый сервер не принял SMTP_USER или SMTP_PASS. Проверьте логин и пароль.\n"
            "У Яндекс 360 и Mail.ru нужен не обычный пароль от ящика, а «пароль\n"
            "приложения» — его создают в настройках безопасности ящика."
        )
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return (
            "Сервер не разрешил отправку от этого адреса. Обычно SMTP_FROM должен\n"
            "совпадать с SMTP_USER (или быть адресом того же домена)."
        )
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "Сервер отказался доставить письмо на этот адрес — проверьте, что адрес верный."
    if isinstance(exc, (smtplib.SMTPException, OSError)):
        other = 587 if port == 465 else 465
        return (
            f"Не удалось связаться с почтовым сервером (порт {port}).\n"
            "Проверьте SMTP_HOST. Если адрес верный, порт может быть закрыт хостингом —\n"
            f"попробуйте SMTP_PORT={other}."
        )
    return "Неожиданная ошибка — подробности выше."


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m app.core.email",
        description="Проверка отправки писем: шлёт тестовое письмо по настройкам SMTP из .env.",
    )
    parser.add_argument("--test", metavar="EMAIL", required=True, help="куда отправить тестовое письмо")
    args = parser.parse_args(argv)

    try:
        conf = smtp_settings()
    except ValueError:
        print("SMTP_PORT в .env должен быть числом (обычно 587 или 465).")
        return 1

    print("Настройки почты:")
    print(f"  SMTP_HOST = {conf['host'] or '— не задан'}")
    print(f"  SMTP_PORT = {conf['port']}")
    print(f"  SMTP_USER = {conf['user'] or '— не задан'}")
    print(f"  SMTP_PASS = {'задан' if conf['password'] else '— не задан'}")
    print(f"  SMTP_FROM = {conf['sender'] or '— не задан (письма уйдут от SMTP_USER)'}")
    print()

    if not email_configured():
        print(
            "Почта не настроена: впишите в .env на сервере SMTP_HOST, SMTP_USER и\n"
            "SMTP_PASS (см. .env.example) и обновите сайт — deploy.bat."
        )
        return 2

    try:
        send_email_sync(
            args.test,
            "ДЕЛО — проверка почты",
            "Это тестовое письмо с маркетплейса ДЕЛО.\n\n"
            "Если вы его читаете, отправка писем настроена правильно: письма для\n"
            "подтверждения почты и сброса пароля будут доходить.",
        )
    except Exception as exc:  # noqa: BLE001 — показываем человеку любую причину
        print(f"Письмо НЕ отправлено: {type(exc).__name__}: {exc}", file=sys.stderr)
        print(_explain_failure(exc, conf["port"]), file=sys.stderr)
        return 1

    print(f"Письмо отправлено на {args.test}. Если его нет во «Входящих» — загляните в «Спам».")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
