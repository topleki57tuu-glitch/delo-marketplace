import secrets
import time
from typing import Optional
from fastapi import HTTPException, Request, status
from app.core.config import settings
from app.core.logging import log_security_event


# ---------------------------------------------------------------------------
# CSRF защита через Double Submit Cookie pattern
#
# Для SPA без серверного рендеринга используем паттерн double-submit:
# 1. Клиент получает CSRF токен через GET /csrf-token
# 2. Сохраняет его в localStorage/sessionStorage
# 3. Отправляет в заголовке X-CSRF-Token при каждом state-changing запросе
# 4. Сервер сверяет токен из заголовка с токеном в signed cookie
#
# Атакующий сайт не может прочитать cookie (Same-Origin Policy) и не знает
# токен, поэтому CSRF атака проваливается даже при отправке cookies браузером.
# ---------------------------------------------------------------------------

_CSRF_COOKIE_NAME = "csrf_token"
_CSRF_HEADER_NAME = "x-csrf-token"
_TOKEN_MAX_AGE = 3600 * 4  # 4 часа


def generate_csrf_token() -> str:
    """Генерирует криптостойкий CSRF токен."""
    return secrets.token_urlsafe(32)


def _sign_token(token: str) -> str:
    """Подписывает токен HMAC для защиты от подделки."""
    import hmac
    import hashlib
    signature = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()[:16]
    return f"{token}.{signature}"


def _verify_token(signed_token: str) -> Optional[str]:
    """Проверяет подпись токена. Возвращает токен или None при ошибке."""
    if "." not in signed_token:
        return None
    token, signature = signed_token.rsplit(".", 1)
    expected = _sign_token(token)
    if not secrets.compare_digest(signed_token, expected):
        return None
    return token


def verify_csrf(request: Request):
    """Middleware-функция для проверки CSRF токена на state-changing запросах.

    Вызывается как Depends() на защищённых эндпоинтах.
    GET/HEAD/OPTIONS пропускаются (не меняют состояние).
    """
    # Безопасные методы не требуют CSRF защиты
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return

    # В development CSRF можно отключить для удобства тестирования
    if not settings.CSRF_ENABLED:
        return

    # Читаем токен из заголовка
    header_token = request.headers.get(_CSRF_HEADER_NAME)
    if not header_token:
        log_security_event(
            event_type="csrf_missing_header",
            ip=request.client.host if request.client else None,
            details=f"{request.method} {request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF токен отсутствует в заголовке X-CSRF-Token"
        )

    # Читаем signed токен из cookie
    cookie_token = request.cookies.get(_CSRF_COOKIE_NAME)
    if not cookie_token:
        log_security_event(
            event_type="csrf_missing_cookie",
            ip=request.client.host if request.client else None,
            details=f"{request.method} {request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF токен отсутствует в cookies — обновите страницу"
        )

    # Проверяем подпись cookie
    verified_cookie_token = _verify_token(cookie_token)
    if not verified_cookie_token:
        log_security_event(
            event_type="csrf_invalid_signature",
            ip=request.client.host if request.client else None,
            details=f"{request.method} {request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF токен в cookie повреждён или подделан"
        )

    # Сверяем токен из заголовка с токеном из cookie
    if not secrets.compare_digest(header_token, verified_cookie_token):
        log_security_event(
            event_type="csrf_token_mismatch",
            ip=request.client.host if request.client else None,
            details=f"{request.method} {request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF токены не совпадают — возможная атака"
        )


def set_csrf_cookie(response, token: str):
    """Устанавливает signed CSRF токен в httpOnly cookie."""
    signed = _sign_token(token)
    response.set_cookie(
        key=_CSRF_COOKIE_NAME,
        value=signed,
        max_age=_TOKEN_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,  # HTTPS — задаётся явно, см. config.COOKIE_SECURE
        samesite="strict"
    )
