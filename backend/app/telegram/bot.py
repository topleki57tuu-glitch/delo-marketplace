"""Процесс Telegram-бота: сообщения пользователей и рассылка.

Запуск (в docker-compose.prod.yml это сервис bot):

    python -m app.telegram.bot

Два потока: один принимает сообщения (long polling), второй каждые
несколько секунд разносит новые уведомления и задания (deliver). Оба
отмечаются в файлах-«пульсах» — по ним Docker понимает, что бот жив
(app/telegram/health.py).
"""
import os
import signal
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Dict, Optional, Set

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import logger
from app.core.presence import user_online
from app.models import User
from app.telegram import client, core
from app.telegram.client import TelegramError

POLL_TIMEOUT = 25
DELIVERY_INTERVAL = float(os.environ.get("TELEGRAM_DELIVERY_INTERVAL", "3"))
PRUNE_INTERVAL = 600
# Пауза между сообщениями рассылки: лимит Telegram — около 30 в секунду.
SEND_PACE = 0.05

COMMANDS = [
    ("start", "Главное меню"),
    ("radar", "Фильтры радара заказов"),
    ("notify", "Уведомления с сайта"),
    ("help", "Что умеет бот"),
    ("stop", "Отключить бота и удалить данные"),
]
DESCRIPTION = (
    "Бот сервиса ДЕЛО. Присылает новые задания по вашим фильтрам — категория, бюджет, "
    "город — и уведомления с сайта: отклики, сообщения, статусы сделок."
)
SHORT_DESCRIPTION = "Новые задания и уведомления сервиса ДЕЛО"


def send(chat_id, text: str, markup: Optional[dict] = None):
    return client.call("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML",
                       reply_markup=markup, disable_web_page_preview=True)


def edit(chat_id, message_id, text: str, markup: Optional[dict] = None) -> None:
    try:
        client.call("editMessageText", chat_id=chat_id, message_id=message_id, text=text,
                    parse_mode="HTML", reply_markup=markup, disable_web_page_preview=True)
    except TelegramError as exc:
        # «message is not modified» — нажали ту же кнопку ещё раз.
        if "not modified" not in exc.description:
            raise


def _linked_user(db: Session, chat) -> Optional[User]:
    return db.get(User, chat.user_id) if chat is not None and chat.user_id else None


# --- входящие сообщения -------------------------------------------------------------

def handle_update(db: Session, update: dict) -> None:
    if update.get("callback_query"):
        handle_callback(db, update["callback_query"])
        return
    message = update.get("message") or {}
    chat_info = message.get("chat") or {}
    # Только личные чаты: в группе радар и уведомления видели бы посторонние.
    if chat_info.get("type") != "private" or not chat_info.get("id"):
        return
    chat_id = chat_info["id"]
    text = (message.get("text") or "").strip()
    if not text:
        return
    command, _, argument = text.partition(" ")
    command = command.split("@", 1)[0].lower() if command.startswith("/") else ""

    if command == "/stop":
        core.delete_chat(db, chat_id)
        send(chat_id, core.STOP_TEXT, {"remove_keyboard": True})
        return

    argument = argument.strip()
    if command == "/start" and argument.startswith(core.LINK_PREFIX):
        # До get_or_create_chat: чат, пришедший по ссылке привязки, создаётся
        # без радара (link_chat), а по негодной ссылке не создаётся вовсе.
        user = core.link_chat(db, chat_id, argument[len(core.LINK_PREFIX):])
        if user is not None:
            send(chat_id, core.linked_text(user, core.get_chat(db, chat_id)), core.main_keyboard())
        else:
            retry = core.site_url("/profile?tab=settings")
            send(chat_id, core.LINK_FAILED_TEXT,
                 {"inline_keyboard": [[{"text": "Открыть настройки", "url": retry}]]} if retry else None)
        return

    chat = core.get_or_create_chat(db, chat_id)

    if command == "/start":
        chat.awaiting = None
        db.commit()
        send(chat_id, core.welcome_text(chat, _linked_user(db, chat)), core.main_keyboard())
        if argument == "radar":
            send(chat_id, core.radar_text(chat), core.radar_keyboard(chat))
        return

    if command in ("/radar", "/my") or text == core.BTN_RADAR:
        chat.awaiting = None
        db.commit()
        send(chat_id, core.radar_text(chat), core.radar_keyboard(chat))
        return
    if command == "/notify" or text == core.BTN_NOTIFY:
        chat.awaiting = None
        db.commit()
        send(chat_id, *core.notify_view(chat, _linked_user(db, chat)))
        return
    if command == "/help" or text == core.BTN_HELP:
        db.commit()
        send(chat_id, core.HELP_TEXT, core.main_keyboard())
        return
    if chat.awaiting == "city" and not command:
        chat.city = core.clean_city(text)
        chat.awaiting = None
        db.commit()
        send(chat_id, core.radar_text(chat), core.radar_keyboard(chat))
        return
    db.commit()
    send(chat_id, core.UNKNOWN_TEXT, core.main_keyboard())


def handle_callback(db: Session, query: dict) -> None:
    notice = None
    try:
        message = query.get("message") or {}
        chat_info = message.get("chat") or {}
        if chat_info.get("type") != "private" or not chat_info.get("id"):
            return
        chat_id, message_id = chat_info["id"], message.get("message_id")
        data = query.get("data") or ""
        chat = core.get_or_create_chat(db, chat_id)

        if data == "r:menu":
            chat.awaiting = None
            db.commit()
            send(chat_id, core.radar_text(chat), core.radar_keyboard(chat))
            return
        if data == "r:b":
            edit(chat_id, message_id, "💰 <b>Минимальный бюджет задания</b>\n\nЗадания дешевле не придут.",
                 core.budget_keyboard(chat))
            return
        if data == "r:city":
            chat.awaiting = "city"
            db.commit()
            send(chat_id, core.CITY_PROMPT,
                 {"inline_keyboard": [[{"text": "Любой город", "callback_data": "r:cityany"}]]})
            return
        if data == "r:cityany":
            chat.city = None
            chat.awaiting = None
            db.commit()
            edit(chat_id, message_id, core.radar_text(chat), core.radar_keyboard(chat))
            return
        if data in ("n:on", "n:off", "n:unlink"):
            if data == "n:unlink":
                core.unlink(db, chat)
                notice = "Аккаунт отвязан"
            else:
                core.set_notify(chat, data == "n:on")
                db.commit()
                notice = "Уведомления включены" if chat.notify_enabled else "Уведомления выключены"
            edit(chat_id, message_id, *core.notify_view(chat, _linked_user(db, chat)))
            return

        if data.startswith("r:c:"):
            core.toggle_category(chat, data[4:])
        elif data == "r:all":
            core.set_categories(chat, [])
        elif data.startswith("r:b:"):
            amount = int(data[4:]) if data[4:].isdigit() else 0
            chat.min_budget = amount if amount in core.BUDGET_CHOICES else 0
        elif data in ("r:on", "r:off"):
            chat.radar_enabled = data == "r:on"
            notice = "Радар включён" if chat.radar_enabled else "Радар выключен"
        elif data != "r:back":
            return
        db.commit()
        edit(chat_id, message_id, core.radar_text(chat), core.radar_keyboard(chat))
    finally:
        try:
            client.call("answerCallbackQuery", callback_query_id=query.get("id"), text=notice)
        except TelegramError:
            pass


# --- рассылка ---------------------------------------------------------------------

def deliver(db: Session, now=None, pace: float = SEND_PACE,
            sender: Callable = send) -> dict:
    """Один проход рассылки: уведомления, потом новые задания радара."""
    now = now or core.now_utc()
    stats = {"notifications": 0, "tasks": 0, "messages": 0, "skipped": 0}
    if _deliver_notifications(db, now, stats, sender):
        _deliver_tasks(db, now, stats, pace, sender)
    return stats


def _deliver_notifications(db: Session, now, stats: dict, sender: Callable) -> bool:
    rows = core.pending_notifications(db, now)
    if not rows:
        return True
    # Несколько сообщений одного чата сделки — одно уведомление «(3)», а не три.
    groups: "OrderedDict[tuple, list]" = OrderedDict()
    for n, chat in rows:
        key = ("message", n.user_id, n.task_id) if n.type == "message" else ("single", n.id)
        groups.setdefault(key, []).append((n, chat))
    users = {u.id: u for u in db.query(User).filter(User.id.in_({n.user_id for n, _ in rows})).all()}
    gone = set()
    for items in groups.values():
        n, chat = items[-1]
        ids = [item.id for item, _ in items]
        if chat.chat_id in gone:
            continue
        # Человек сейчас на сайте и видит переписку — Telegram не дёргаем.
        if n.type == "message" and user_online(users.get(n.user_id)):
            core.mark_delivered(db, core.KIND_NOTIFICATION, ids)
            db.commit()
            stats["skipped"] += len(ids)
            continue
        text, markup = core.notification_message(n, count=len(items))
        try:
            sender(chat.chat_id, text, markup)
            stats["notifications"] += 1
        except TelegramError as exc:
            if exc.temporary:
                db.rollback()
                logger.warning(f"telegram: уведомления отложены — {exc}")
                return False
            if exc.chat_gone:
                gone.add(chat.chat_id)
                core.delete_chat(db, chat.chat_id)
                continue
            logger.warning(f"telegram: уведомление {n.id} не принято — {exc}")
        core.mark_delivered(db, core.KIND_NOTIFICATION, ids)
        db.commit()
    return True


# Задание, рассылку которого прервал сбой Telegram: кому оно уже ушло.
# Следующий проход продолжит с места остановки, а не начнёт заново — иначе
# первые подписчики получили бы его дважды. Живёт в памяти: после
# перезапуска процесса повтор возможен, но это редкость, а не правило.
_task_progress: Dict[int, Set[int]] = {}


def _deliver_tasks(db: Session, now, stats: dict, pace: float, sender: Callable) -> None:
    tasks = core.pending_tasks(db, now)
    if not tasks:
        return
    chats = core.radar_chats(db)
    gone = set()
    for task in tasks:
        text, markup = core.task_message(task)
        done = _task_progress.setdefault(task.id, set())
        for chat in chats:
            if chat.chat_id in gone or chat.chat_id in done or not core.task_matches(chat, task):
                continue
            try:
                sender(chat.chat_id, text, markup)
                stats["messages"] += 1
            except TelegramError as exc:
                if exc.temporary:
                    db.rollback()
                    logger.warning(f"telegram: радар отложен — {exc}")
                    return
                if exc.chat_gone:
                    gone.add(chat.chat_id)
                    core.delete_chat(db, chat.chat_id)
                else:
                    logger.warning(f"telegram: задание {task.id} не отправлено в чат — {exc}")
            done.add(chat.chat_id)
            if pace:
                time.sleep(pace)
        core.mark_delivered(db, core.KIND_TASK, [task.id])
        db.commit()
        _task_progress.pop(task.id, None)
        stats["tasks"] += 1


# --- процесс ----------------------------------------------------------------------

def _heartbeat(name: str) -> None:
    try:
        Path(os.environ.get("TELEGRAM_HEARTBEAT_DIR", "/tmp"), f"delo-bot-{name}").touch()
    except OSError:
        pass


def _session() -> Session:
    # Объекты нужны и после commit (рассылка коммитит после каждой отправки).
    return SessionLocal(expire_on_commit=False)


def setup() -> str:
    """Имя бота; заодно команды, описание и кнопка меню «ДЕЛО» (Mini App)."""
    me = client.call("getMe")
    # Вебхук и getUpdates взаимоисключающие: снимаем вебхук, если остался.
    client.call("deleteWebhook", drop_pending_updates=False)
    optional = [
        ("setMyCommands", {"commands": [{"command": c, "description": d} for c, d in COMMANDS]}),
        ("setMyDescription", {"description": DESCRIPTION}),
        ("setMyShortDescription", {"short_description": SHORT_DESCRIPTION}),
    ]
    app_url = core.web_app_url("/")
    if app_url:
        optional.append(("setChatMenuButton",
                         {"menu_button": {"type": "web_app", "text": "ДЕЛО", "web_app": {"url": app_url}}}))
    for method, params in optional:
        try:
            client.call(method, **params)
        except TelegramError as exc:
            logger.warning(f"telegram: {method} — {exc}")
    return me.get("username") or ""


def updates_loop(stop: threading.Event) -> None:
    offset = None
    while not stop.is_set():
        _heartbeat("updates")
        try:
            updates = client.call("getUpdates", http_timeout=POLL_TIMEOUT + 10, timeout=POLL_TIMEOUT,
                                  offset=offset, allowed_updates=["message", "callback_query"])
        except TelegramError as exc:
            if exc.code == 409:
                logger.error("telegram: этот токен опрашивает другая копия бота (409 Conflict). "
                             "Остановите её или выпустите новый токен в @BotFather (/revoke).")
                stop.wait(15)
            elif exc.code == 401:
                logger.error("telegram: Telegram не принял токен (401) — проверьте TELEGRAM_BOT_TOKEN")
                stop.wait(60)
            else:
                logger.warning(f"telegram: getUpdates — {exc}")
                stop.wait(3)
            continue
        for update in updates or []:
            offset = update["update_id"] + 1
            db = _session()
            try:
                handle_update(db, update)
            except TelegramError as exc:
                db.rollback()
                logger.warning(f"telegram: ответ не отправлен — {exc}")
            except Exception:
                db.rollback()
                logger.exception("telegram: ошибка обработки сообщения")
            finally:
                db.close()


def delivery_loop(stop: threading.Event) -> None:
    last_prune = 0.0
    while not stop.is_set():
        _heartbeat("delivery")
        db = _session()
        try:
            deliver(db)
            if time.monotonic() - last_prune > PRUNE_INTERVAL:
                core.prune(db, core.now_utc())
                last_prune = time.monotonic()
        except Exception:
            db.rollback()
            logger.exception("telegram: ошибка рассылки")
        finally:
            db.close()
        stop.wait(DELIVERY_INTERVAL)


def _start_health_server(port: int) -> None:
    """Для хостингов, которым нужен HTTP-порт (Render, тип web)."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def main() -> None:
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    if os.environ.get("PORT", "").isdigit():
        _start_health_server(int(os.environ["PORT"]))

    if not client.bot_token():
        logger.warning("telegram: TELEGRAM_BOT_TOKEN не задан — бот ждёт токен и ничего не делает")
        while not stop.is_set():
            _heartbeat("updates")
            _heartbeat("delivery")
            stop.wait(30)
        return

    while not stop.is_set():
        _heartbeat("updates")
        _heartbeat("delivery")
        try:
            username = setup()
            break
        except TelegramError as exc:
            logger.error(f"telegram: бот не запустился — {exc}; повтор через 15 с")
            stop.wait(15)
    else:
        return
    logger.info(f"telegram: бот @{username} запущен")

    threads = [threading.Thread(target=fn, args=(stop,), name=fn.__name__, daemon=True)
               for fn in (updates_loop, delivery_loop)]
    for thread in threads:
        thread.start()
    while not stop.is_set():
        stop.wait(1)
    logger.info("telegram: бот остановлен")


if __name__ == "__main__":
    main()
