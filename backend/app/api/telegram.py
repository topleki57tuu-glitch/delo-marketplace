"""Telegram на сайте: ссылка на бота и привязка аккаунта к чату.

Сам бот — отдельный процесс (app/telegram/bot.py). Здесь только то, что
нужно странице: есть ли бот, привязан ли аккаунт, одноразовая ссылка
t.me/<бот>?start=link_<токен> и отвязка. В базе хранится лишь хэш токена,
ссылка живёт 15 минут и срабатывает один раз (app/telegram/core.py).
"""
import os
import re
import threading
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.database import get_db
from app.core.logging import logger
from app.core.security import decode_token, oauth2_scheme, rate_limit
from app.models import TelegramChat, TelegramLinkToken
from app.telegram import client, core

router = APIRouter(prefix="/telegram", tags=["Telegram"])

# Имя бота в Telegram: 5–32 символа, латиница, цифры и «_».
_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
_CACHE_TTL = 3600     # имя бота меняется редко — спрашиваем раз в час
_RETRY_AFTER = 60     # Telegram не ответил — не дёргаем его на каждый запрос
_cache = {"username": None, "until": 0.0}
_lock = threading.Lock()

UNLINKED_TEXT = (
    "🔕 Аккаунт отвязан на сайте — личные уведомления больше не придут.\n"
    "Радар заказов работает как раньше: /radar. Удалить всё — /stop."
)


def bot_username() -> Optional[str]:
    """Имя бота без «@»: из TELEGRAM_BOT_USERNAME или у Telegram (getMe)."""
    configured = (os.environ.get("TELEGRAM_BOT_USERNAME") or "").strip().lstrip("@")
    if configured:
        return configured if _USERNAME_RE.match(configured) else None
    if not client.bot_token():
        return None
    with _lock:
        now = time.monotonic()
        if now < _cache["until"]:
            return _cache["username"]
        try:
            username = (client.call("getMe", http_timeout=5) or {}).get("username")
        except client.TelegramError as exc:
            # Прежнее имя (если было) оставляем: сбой сети не выключает кнопку.
            logger.warning("telegram: getMe не ответил: %s", exc)
            _cache["until"] = now + _RETRY_AFTER
            return _cache["username"]
        if username and _USERNAME_RE.match(username):
            _cache.update(username=username, until=now + _CACHE_TTL)
        else:
            _cache["until"] = now + _RETRY_AFTER
        return _cache["username"]


def _bot_url(username: str, start: str) -> str:
    return f"https://t.me/{username}?start={start}"


def _user_id(token: str) -> int:
    try:
        return int(decode_token(token).get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Неверный или просроченный токен авторизации")


def _say_unlinked(chat_id: int) -> None:
    try:
        client.call("sendMessage", http_timeout=5, chat_id=chat_id, text=UNLINKED_TEXT)
    except client.TelegramError as exc:
        logger.info("telegram: не сообщили об отвязке: %s", exc)


@router.get("/info")
def telegram_info():
    """Публично: подключён ли бот и ссылка на радар заказов."""
    username = bot_username()
    return {
        "enabled": bool(username),
        "username": username,
        "url": _bot_url(username, "radar") if username else None,
    }


@router.get("/status")
def telegram_status(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    user_id = _user_id(token)
    chat = db.query(TelegramChat).filter(TelegramChat.user_id == user_id).first()
    username = bot_username()
    return {
        "enabled": bool(username),
        "username": username,
        "linked": chat is not None,
        "linked_at": chat.linked_at if chat else None,
        "notify_enabled": bool(chat and chat.notify_enabled),
        "radar_enabled": bool(chat and chat.radar_enabled),
    }


@router.post("/link")
def telegram_link(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),
):
    """Одноразовая ссылка: открыть в Telegram и нажать «Старт»."""
    user_id = _user_id(token)
    rate_limit(request, "telegram_link", limit=20, window_sec=600)
    username = bot_username()
    if not username:
        raise HTTPException(status_code=503, detail="Telegram-бот пока не подключён")
    raw = core.create_link_token(db, user_id)
    return {
        "url": _bot_url(username, core.LINK_PREFIX + raw),
        "expires_in": int(core.LINK_TOKEN_TTL.total_seconds()),
    }


@router.delete("/link")
def telegram_unlink(
    background: BackgroundTasks,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf),
):
    user_id = _user_id(token)
    chat = db.query(TelegramChat).filter(TelegramChat.user_id == user_id).first()
    chat_id = chat.chat_id if chat else None
    unlinked = core.unlink(db, chat)
    # Выданные, но не открытые ссылки тоже гасим.
    db.query(TelegramLinkToken).filter(TelegramLinkToken.user_id == user_id).delete(synchronize_session=False)
    db.commit()
    if unlinked and chat_id is not None and client.bot_token():
        background.add_task(_say_unlinked, chat_id)
    return {"unlinked": unlinked}
