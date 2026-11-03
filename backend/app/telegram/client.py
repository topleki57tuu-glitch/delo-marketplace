"""Минимальный клиент Telegram Bot API — на requests, без сторонних SDK.

Адрес API можно переопределить переменной TELEGRAM_API_URL (как в
scripts/ops_common.sh): для тестов с поддельным сервером или для прокси,
если с сервера api.telegram.org недоступен.
"""
import os
import threading
import time
from typing import Any, Optional

import requests

DEFAULT_API_URL = "https://api.telegram.org"

_local = threading.local()


class TelegramError(Exception):
    """Ошибка Bot API. code 0 — запрос не дошёл (сеть, таймаут)."""

    def __init__(self, code: int, description: str = "", retry_after: Optional[float] = None):
        super().__init__(f"{code}: {description}")
        self.code = int(code or 0)
        self.description = description or ""
        self.retry_after = retry_after

    @property
    def chat_gone(self) -> bool:
        """Писать в чат больше нельзя: бота заблокировали, чат удалён."""
        desc = self.description.lower()
        return self.code == 403 or (
            self.code == 400 and ("chat not found" in desc or "user is deactivated" in desc)
        )

    @property
    def temporary(self) -> bool:
        """Стоит повторить позже: сеть, лимит частоты, сбой на стороне Telegram."""
        return self.code == 0 or self.code == 429 or self.code >= 500


def bot_token() -> str:
    # TG_BOT_TOKEN — имя из прежнего бота (bot/bot.py), чтобы старый .env
    # продолжал работать.
    return (os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("TG_BOT_TOKEN") or "").strip()


def api_url() -> str:
    return (os.environ.get("TELEGRAM_API_URL") or DEFAULT_API_URL).rstrip("/")


def _session() -> requests.Session:
    # requests.Session не потокобезопасна, а у бота два потока.
    session = getattr(_local, "session", None)
    if session is None:
        session = _local.session = requests.Session()
    return session


def call(method: str, http_timeout: float = 15, **params: Any) -> Any:
    """Вызвать метод Bot API и вернуть result. Ошибка — TelegramError.

    http_timeout — таймаут HTTP-запроса; параметр timeout у getUpdates —
    это уже параметр самого Bot API (сколько секунд ждать новых сообщений).
    Один повтор при 429 (Telegram сам говорит, сколько подождать).
    Текст сетевых исключений в ошибку не попадает: в нём URL, а в URL — токен.
    """
    token = bot_token()
    if not token:
        raise TelegramError(0, "TELEGRAM_BOT_TOKEN не задан")
    url = f"{api_url()}/bot{token}/{method}"
    payload = {k: v for k, v in params.items() if v is not None}
    for attempt in range(2):
        try:
            response = _session().post(url, json=payload, timeout=http_timeout)
        except requests.RequestException as exc:
            raise TelegramError(0, f"нет связи с Telegram ({type(exc).__name__})") from None
        try:
            data = response.json()
        except ValueError:
            raise TelegramError(response.status_code, f"HTTP {response.status_code}") from None
        if data.get("ok"):
            return data.get("result")
        code = data.get("error_code") or response.status_code
        retry_after = (data.get("parameters") or {}).get("retry_after")
        if code == 429 and retry_after and attempt == 0:
            time.sleep(min(float(retry_after), 30.0))
            continue
        raise TelegramError(code, data.get("description", ""), retry_after)
    raise TelegramError(429, "Too Many Requests")
