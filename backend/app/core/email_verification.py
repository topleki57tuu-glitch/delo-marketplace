"""Подтверждение почты.

Зачем. Регистрация принимала любой адрес, и ничто не проверяло, что ящик
принадлежит этому человеку. Письма (сброс пароля, уведомления) могли уходить
чужому или в никуда, а для денег это важно вдвойне: по почте
восстанавливается пароль, значит, вывод средств должен быть у владельца
ящика, а не у того, кто первым вписал чужой адрес.

Как. После регистрации отправляем письмо со ссылкой
``{FRONTEND_URL}/verify-email?token=…``. Страница сайта отправляет токен на
``POST /auth/verify-email``. Токен — подписанный JWT (тот же SECRET_KEY) с
``type="email_verify"``, id пользователя и самим адресом; живёт 3 дня.
В базе токены не храним: подтверждение можно повторять, а «Отправить письмо
ещё раз» просто выдаёт новую ссылку. Адрес внутри токена сверяется с
текущим — старая ссылка не подтвердит другой адрес.

Входом такая ссылка не станет: decode_token (app/core/security.py)
принимает только ``type="access"``.

Что требует подтверждённой почты. Пока только вывод денег
(``POST /wallet/withdraw``) — и только когда на сервере настроена отправка
писем (SMTP): без неё подтвердить почту невозможно, и требование закрыло
бы вывод всем. ``EMAIL_VERIFICATION_REQUIRED=0`` в .env выключает
требование (например, если почтовый сервис временно сломался).
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import jwt
from jwt import PyJWTError
from fastapi import HTTPException

from app.core.config import settings
from app.core.email import EmailNotConfigured, email_configured, send_email_sync

logger = logging.getLogger(__name__)

TOKEN_TYPE = "email_verify"
TOKEN_TTL = timedelta(days=3)

NOT_VERIFIED_MESSAGE = (
    "Подтвердите почту, чтобы выводить деньги: перейдите по ссылке из письма. "
    "Письма нет — нажмите «Отправить письмо ещё раз» в профиле."
)


def frontend_url() -> str:
    return (settings.FRONTEND_URL or os.environ.get("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def create_token(user) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "type": TOKEN_TYPE,
        "iat": now,
        "exp": now + TOKEN_TTL,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def read_token(token: str) -> Optional[dict]:
    """Payload действующего токена подтверждения или None.

    Отдельно сообщаем только «истёк»: человеку важно знать, что ссылку
    нужно запросить заново, а не что она «битая».
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError:
        return {"expired": True}
    except PyJWTError:
        return None
    if payload.get("type") != TOKEN_TYPE or not payload.get("sub") or not payload.get("email"):
        return None
    return payload


def verification_link(user) -> str:
    return f"{frontend_url()}/verify-email?token={quote(create_token(user))}"


def is_verified(user) -> bool:
    return getattr(user, "email_verified_at", None) is not None


def can_send() -> bool:
    """Можно ли сейчас получить ссылку: почта настроена или это стенд разработчика."""
    return email_configured() or not settings.IS_PRODUCTION


def required() -> bool:
    """Нужна ли подтверждённая почта для вывода денег."""
    if os.environ.get("EMAIL_VERIFICATION_REQUIRED", "").strip().lower() in ("0", "false", "no", "off"):
        return False
    return email_configured()


def require_verified(user) -> None:
    """403 с понятным текстом, если почта не подтверждена, а требование включено."""
    if required() and not is_verified(user):
        raise HTTPException(403, NOT_VERIFIED_MESSAGE)


def _days(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} день"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f"{n} дня"
    return f"{n} дней"


def _body(link: str) -> str:
    return (
        "Здравствуйте!\n\n"
        "Вы зарегистрировались на маркетплейсе ДЕЛО. Подтвердите почту — перейдите по ссылке\n"
        f"(она действует {_days(TOKEN_TTL.days)}):\n\n{link}\n\n"
        "Подтверждённая почта нужна, чтобы выводить деньги и восстанавливать доступ к аккаунту.\n\n"
        "Если вы не регистрировались — просто проигнорируйте это письмо."
    )


def send(user) -> Optional[str]:
    """Отправить письмо со ссылкой прямо сейчас.

    Возвращает ссылку, если почта не настроена и это стенд разработчика
    (её показывают вместо письма — как dev_reset_link при сбросе пароля).

    Raises:
        EmailNotConfigured: почта не настроена на боевом сервере.
        Exception: SMTP задан, но письмо не ушло.
    """
    link = verification_link(user)
    try:
        send_email_sync(user.email, "ДЕЛО — подтвердите почту", _body(link))
    except EmailNotConfigured:
        if settings.IS_PRODUCTION:
            raise
        return link
    return None


def send_quietly(email: str, link: str) -> None:
    """Для фоновой отправки после регистрации: ошибка — в журнал, не пользователю."""
    try:
        send_email_sync(email, "ДЕЛО — подтвердите почту", _body(link))
    except EmailNotConfigured:
        pass
    except Exception as exc:  # noqa: BLE001 — регистрация уже прошла, письмо можно запросить снова
        logger.warning("Письмо для подтверждения почты не отправлено: %s", exc)
