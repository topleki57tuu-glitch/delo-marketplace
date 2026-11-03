"""Данные и тексты бота: привязка аккаунта, фильтры радара, что и кому слать.

Здесь нет сетевых вызовов: только база и форматирование. Отправка — в bot.py.
"""
import hashlib
import html
import re
import secrets
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Iterable, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    Notification, Task, TaskStatus, TelegramChat, TelegramDelivery,
    TelegramLinkToken, User,
)

LINK_PREFIX = "link_"
LINK_TOKEN_TTL = timedelta(minutes=15)
# Насколько назад бот ищет неотправленное. Короткий перезапуск ничего не
# теряет, а после долгого простоя не приходит лавина устаревших заданий.
LOOKBACK = timedelta(hours=2)
# Отметки об отправке старше LOOKBACK уже ни на что не влияют.
DELIVERY_KEEP = timedelta(days=3)

KIND_NOTIFICATION = "n"
KIND_TASK = "t"

# Названия — как на сайте (frontend/src/utils/taskCategories.js).
CATEGORY_LABELS = {
    "development": "Разработка сайтов и IT",
    "design": "Дизайн и графика",
    "writing": "Тексты и переводы",
    "repairs": "Ремонт и строительство",
    "cleaning": "Уборка и клининг",
    "delivery": "Курьеры и доставка",
    "photo_video": "Фото и видео",
    "tutoring": "Репетиторы",
    "beauty": "Красота",
    "events": "Мероприятия",
    "business": "Бизнес-услуги",
    "other": "Другое",
}
# Короткие подписи для кнопок: две в ряд на экране телефона.
CATEGORY_BUTTONS = [
    ("development", "💻 Сайты и IT"),
    ("design", "🎨 Дизайн"),
    ("writing", "✍️ Тексты"),
    ("repairs", "🔨 Ремонт"),
    ("cleaning", "🧹 Уборка"),
    ("delivery", "🚚 Курьеры"),
    ("photo_video", "📷 Фото и видео"),
    ("tutoring", "🎓 Репетиторы"),
    ("beauty", "💅 Красота"),
    ("events", "🎉 Мероприятия"),
    ("business", "💼 Бизнес-услуги"),
    ("other", "📦 Другое"),
]
BUDGET_CHOICES = [0, 1000, 3000, 5000, 10000, 30000]

NOTIFICATION_ICONS = {
    "new_response": "📝", "assigned": "🤝", "completed": "✅", "review": "⭐",
    "message": "💬", "payment": "💳", "withdrawal": "💸", "verification": "🪪",
    "dispute": "⚖️", "dispute_resolved": "⚖️", "cancelled": "❌",
    "new_order": "🛒", "password_changed": "🔐", "password_change_failed": "🔐",
}

BTN_RADAR = "🎯 Радар заказов"
BTN_NOTIFY = "🔔 Уведомления"
BTN_APP = "📱 Открыть ДЕЛО"
BTN_HELP = "❓ Помощь"


def now_utc() -> datetime:
    # Как и везде в моделях: naive UTC (datetime.utcnow в default колонок).
    return datetime.utcnow()


def escape(value) -> str:
    """Текст пользователя в сообщение с parse_mode=HTML."""
    return html.escape(str(value if value is not None else ""), quote=False)


def short(value, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def money(amount) -> str:
    return f"{int(amount):,} ₽".replace(",", " ")


def category_code(value) -> str:
    return getattr(value, "value", value) or "other"


# --- адреса сайта ---------------------------------------------------------------

def site_url(path: str = "/") -> Optional[str]:
    """Адрес страницы сайта для кнопки. None — FRONTEND_URL не задан.

    Кириллический домен переводится в punycode (дело.online →
    xn--d1acsm.online): Bot API принимает в кнопках только ASCII-адреса.
    """
    base = (settings.FRONTEND_URL or "").strip().rstrip("/")
    if base and "://" not in base:
        base = "https://" + base  # Render отдаёт адрес сервиса без схемы
    parts = urlsplit(base)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    try:
        host = parts.hostname.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    netloc = host + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path, "", "")) + path


def web_app_url(path: str = "/") -> Optional[str]:
    """Адрес для кнопки Mini App: Telegram открывает их только по HTTPS."""
    url = site_url(path)
    return url if url and url.startswith("https://") else None


# --- чаты и привязка аккаунта ---------------------------------------------------

def get_chat(db: Session, chat_id) -> Optional[TelegramChat]:
    return db.get(TelegramChat, int(chat_id))


def get_or_create_chat(db: Session, chat_id, radar: bool = True) -> TelegramChat:
    """radar — включать ли радар новому чату. Пришедшим по ссылке привязки
    он выключен: им нужны уведомления, а не все задания площадки подряд."""
    chat = get_chat(db, chat_id)
    if chat is None:
        chat = TelegramChat(chat_id=int(chat_id), radar_enabled=radar, notify_enabled=True, min_budget=0)
        db.add(chat)
        db.flush()
    return chat


def delete_chat(db: Session, chat_id) -> None:
    """Всё о чате — фильтры, привязку — удалить (/stop, бот заблокирован)."""
    db.query(TelegramChat).filter(TelegramChat.chat_id == int(chat_id)).delete(synchronize_session=False)
    db.commit()


def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_link_token(db: Session, user_id: int) -> str:
    """Новая одноразовая ссылка привязки; прежние ссылки пользователя гаснут."""
    db.query(TelegramLinkToken).filter(TelegramLinkToken.user_id == user_id).delete(synchronize_session=False)
    # 32 символа [A-Za-z0-9_-]: вместе с link_ укладывается в 64 символа,
    # которые Telegram допускает в параметре start.
    raw = secrets.token_urlsafe(24)
    db.add(TelegramLinkToken(token_hash=_token_hash(raw), user_id=user_id,
                             expires_at=now_utc() + LINK_TOKEN_TTL))
    db.commit()
    return raw


def link_chat(db: Session, chat_id, raw: str) -> Optional[User]:
    """Привязать чат к аккаунту по токену из ссылки. None — ссылка негодна."""
    if not raw or len(raw) > 64:
        return None
    row = db.get(TelegramLinkToken, _token_hash(raw))
    if row is None:
        return None
    user_id, expired = row.user_id, row.expires_at < now_utc()
    db.delete(row)  # одноразовая — даже если опоздали
    user = None if expired else db.get(User, user_id)
    if user is None:
        db.commit()
        return None
    # Аккаунт был привязан к другому чату — привязка переезжает сюда.
    db.query(TelegramChat).filter(
        TelegramChat.user_id == user.id, TelegramChat.chat_id != int(chat_id)
    ).update({"user_id": None, "linked_at": None, "notify_since": None}, synchronize_session=False)
    chat = get_or_create_chat(db, chat_id, radar=False)
    chat.user_id = user.id
    chat.linked_at = chat.notify_since = now_utc()
    chat.notify_enabled = True
    db.commit()
    return user


def unlink(db: Session, chat: Optional[TelegramChat]) -> bool:
    if chat is None or chat.user_id is None:
        return False
    chat.user_id = chat.linked_at = chat.notify_since = None
    db.commit()
    return True


def unlink_user(db: Session, user_id: int) -> bool:
    return unlink(db, db.query(TelegramChat).filter(TelegramChat.user_id == user_id).first())


def set_notify(chat: TelegramChat, enabled: bool) -> None:
    chat.notify_enabled = enabled
    if enabled:
        # Пока уведомления были выключены, их не копили: начинаем с этой минуты.
        chat.notify_since = now_utc()


def masked_email(email: Optional[str]) -> str:
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "аккаунт"
    return f"{name[:1]}***@{domain}"


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def hide_emails(text: str) -> str:
    """Email в тексте уведомления → маска. Сайт подставляет email вместо
    пустого имени («ivan@mail.ru: привет»), а в Telegram, на чужие серверы,
    адрес собеседника уходить не должен — для узнавания хватит маски."""
    return _EMAIL_RE.sub(lambda m: masked_email(m.group(0)), text or "")


# --- фильтры радара -------------------------------------------------------------

def chat_categories(chat) -> List[str]:
    return [c for c in (chat.categories or "").split(",") if c in CATEGORY_LABELS]


def set_categories(chat: TelegramChat, codes: Iterable[str]) -> None:
    wanted = set(codes)
    chat.categories = ",".join(code for code, _ in CATEGORY_BUTTONS if code in wanted) or None


def toggle_category(chat: TelegramChat, code: str) -> None:
    if code not in CATEGORY_LABELS:
        return
    current = set(chat_categories(chat))
    current.symmetric_difference_update({code})
    set_categories(chat, current)


def clean_city(text: str) -> Optional[str]:
    city = " ".join((text or "").split())[:60]
    return None if city.lower() in ("", "-", "любой", "любой город", "все", "везде") else city


def task_matches(chat, task) -> bool:
    if not chat.radar_enabled:
        return False
    if chat.user_id is not None and chat.user_id == task.customer_id:
        return False  # своё задание присылать незачем
    categories = chat_categories(chat)
    if categories and category_code(task.category) not in categories:
        return False
    if chat.min_budget and (task.budget or 0) < chat.min_budget:
        return False
    city = (chat.city or "").strip().lower()
    if city and not task.is_remote and city not in (task.city or "").lower():
        return False
    return True


def snapshot(chat: TelegramChat) -> SimpleNamespace:
    """Копия фильтров без привязки к сессии: рассылка удаляет чаты на ходу."""
    return SimpleNamespace(chat_id=chat.chat_id, user_id=chat.user_id, radar_enabled=chat.radar_enabled,
                           categories=chat.categories, min_budget=chat.min_budget, city=chat.city)


# --- что отправить ----------------------------------------------------------------

def pending_notifications(db: Session, now: datetime, limit: int = 50) -> List[Tuple[Notification, TelegramChat]]:
    """Свежие уведомления привязанных пользователей, которых бот ещё не слал."""
    return (
        db.query(Notification, TelegramChat)
        .join(TelegramChat, TelegramChat.user_id == Notification.user_id)
        .outerjoin(TelegramDelivery, and_(TelegramDelivery.kind == KIND_NOTIFICATION,
                                          TelegramDelivery.object_id == Notification.id))
        .filter(
            TelegramDelivery.object_id.is_(None),
            TelegramChat.notify_enabled.is_(True),
            Notification.created_at >= now - LOOKBACK,
            Notification.created_at >= TelegramChat.notify_since,
        )
        .order_by(Notification.id)
        .limit(limit)
        .all()
    )


def pending_tasks(db: Session, now: datetime, limit: int = 20) -> List[Task]:
    """Новые открытые задания, которые радар ещё не разослал."""
    return (
        db.query(Task)
        .outerjoin(TelegramDelivery, and_(TelegramDelivery.kind == KIND_TASK,
                                          TelegramDelivery.object_id == Task.id))
        .filter(
            TelegramDelivery.object_id.is_(None),
            Task.status == TaskStatus.open,
            Task.created_at >= now - LOOKBACK,
        )
        .order_by(Task.id)
        .limit(limit)
        .all()
    )


def radar_chats(db: Session) -> List[SimpleNamespace]:
    return [snapshot(c) for c in db.query(TelegramChat).filter(TelegramChat.radar_enabled.is_(True)).all()]


def mark_delivered(db: Session, kind: str, object_ids: Iterable[int]) -> None:
    for object_id in object_ids:
        db.merge(TelegramDelivery(kind=kind, object_id=object_id, created_at=now_utc()))


def prune(db: Session, now: datetime) -> None:
    db.query(TelegramDelivery).filter(TelegramDelivery.created_at < now - DELIVERY_KEEP).delete(synchronize_session=False)
    db.query(TelegramLinkToken).filter(TelegramLinkToken.expires_at < now).delete(synchronize_session=False)
    db.commit()


# --- тексты -----------------------------------------------------------------------

def task_message(task: Task) -> Tuple[str, dict]:
    """Задание для радара. Точного адреса нет: подписаться может кто угодно,
    а адрес заказчика — чаще всего домашний (как и в ленте сайта)."""
    place = "🌐 Удалённо" if task.is_remote else f"📍 {escape(task.city or 'Город не указан')}"
    budget = money(task.budget) if task.budget else "Цена договорная"
    lines = [
        "🎯 <b>Новое задание</b>",
        "",
        f"<b>{escape(short(task.title, 120))}</b>",
        f"📂 {escape(CATEGORY_LABELS.get(category_code(task.category), 'Другое'))}",
        place,
        f"💰 <b>{budget}</b>",
    ]
    description = short(task.description, 300)
    if description:
        lines += ["", escape(description)]
    path = f"/tasks/{task.id}"
    first_row = []
    if web_app_url(path):
        first_row.append({"text": "📱 Открыть", "web_app": {"url": web_app_url(path)}})
    if site_url(path):
        first_row.append({"text": "🌐 В браузере", "url": site_url(path)})
    rows = [first_row] if first_row else []
    rows.append([{"text": "⚙️ Фильтры радара", "callback_data": "r:menu"}])
    return "\n".join(lines), {"inline_keyboard": rows}


def notification_path(n: Notification) -> str:
    kind = n.type or ""
    if kind == "message":
        return f"/chats?taskId={n.task_id}" if n.task_id else "/chats"
    if kind in ("payment", "withdrawal"):
        return "/profile?tab=wallet"
    if kind.startswith("password"):
        return "/profile?tab=settings"
    if kind == "verification":
        return "/profile"
    if kind == "new_order" or kind.startswith("order_"):
        return "/my-orders"
    if n.task_id:
        return f"/tasks/{n.task_id}"
    if kind.startswith("dispute"):
        return "/disputes"
    return "/profile"


def notification_message(n: Notification, count: int = 1) -> Tuple[str, Optional[dict]]:
    icon = NOTIFICATION_ICONS.get(n.type or "", "📦" if (n.type or "").startswith("order_") else "🔔")
    title = short(hide_emails(n.title) or "Уведомление", 120)
    if count > 1:
        title = f"{title} ({count})"
    text = f"{icon} <b>{escape(title)}</b>"
    if n.text:
        text += "\n" + escape(short(hide_emails(n.text), 700))
    url = site_url(notification_path(n))
    markup = {"inline_keyboard": [[{"text": "Открыть на сайте", "url": url}]]} if url else None
    return text, markup


def main_keyboard() -> dict:
    second = []
    if web_app_url("/"):
        second.append({"text": BTN_APP, "web_app": {"url": web_app_url("/")}})
    second.append({"text": BTN_HELP})
    return {"keyboard": [[{"text": BTN_RADAR}, {"text": BTN_NOTIFY}], second],
            "resize_keyboard": True, "is_persistent": True}


def welcome_text(chat: TelegramChat, user: Optional[User] = None) -> str:
    account = (
        f"🔔 Аккаунт <b>{escape(user.name or masked_email(user.email))}</b> подключён: сюда приходят "
        "отклики, сообщения и статусы сделок."
        if user else
        "🔔 <b>Уведомления</b> — отклики, сообщения и статусы сделок с сайта. Чтобы их получать, "
        "подключите аккаунт: «Профиль → Настройки → Подключить Telegram»."
    )
    radar = "уже включён" if chat.radar_enabled else "выключен"
    return (
        "👋 <b>Это бот сервиса ДЕЛО</b>\n\n"
        f"🎯 <b>Радар заказов</b> {radar}: новые задания приходят сюда сразу после публикации. "
        "Категории, бюджет и город — кнопка «🎯 Радар заказов».\n\n"
        f"{account}"
    )


HELP_TEXT = (
    "<b>Что умеет бот</b>\n\n"
    "🎯 /radar — фильтры радара: категории, минимальный бюджет, город\n"
    "🔔 /notify — уведомления с сайта и привязка аккаунта\n"
    "🛑 /stop — отключить бота и удалить данные этого чата\n"
    "🏠 /start — главное меню\n\n"
    "Кнопка «📱 Открыть ДЕЛО» открывает сайт прямо в Telegram."
)
STOP_TEXT = (
    "🛑 Бот отключён: радар и уведомления больше не придут, настройки этого чата "
    "и привязка аккаунта удалены.\n\nВернуться — /start."
)
CITY_PROMPT = "📍 Напишите город одним сообщением, например «Казань».\nУдалённые задания приходят при любом городе."
LINK_FAILED_TEXT = (
    "⚠️ Ссылка для подключения устарела или уже использована.\n\n"
    "Откройте на сайте «Профиль → Настройки» и нажмите «Подключить Telegram» ещё раз — "
    "ссылка действует 15 минут."
)
UNKNOWN_TEXT = "Не понял сообщение. Выберите действие на клавиатуре ниже или напишите /help."


def linked_text(user: User, chat: TelegramChat) -> str:
    radar = (
        "🎯 Радар заказов тоже включён — фильтры: /radar."
        if chat.radar_enabled else
        "🎯 Ищете заказы? Включите радар — новые задания по вашим фильтрам: /radar."
    )
    return (
        f"✅ Аккаунт <b>{escape(user.name or masked_email(user.email))}</b> подключён.\n\n"
        "Сюда будут приходить отклики, сообщения, оплата и статусы сделок. "
        f"Выключить — /notify.\n\n{radar}"
    )


def radar_text(chat: TelegramChat) -> str:
    categories = chat_categories(chat)
    cats = "все" if not categories else ", ".join(CATEGORY_LABELS[c] for c in categories)
    budget = f"от {money(chat.min_budget)}" if chat.min_budget else "любой"
    state = "включён" if chat.radar_enabled else "выключен"
    return (
        f"🎯 <b>Радар заказов {state}</b>\n\n"
        f"📂 Категории: {escape(cats)}\n"
        f"💰 Бюджет: {budget}\n"
        f"📍 Город: {escape(chat.city or 'любой')}\n\n"
        "Нажимайте на категории, чтобы выбрать нужные. Удалённые задания приходят при любом городе."
    )


def radar_keyboard(chat: TelegramChat) -> dict:
    selected = set(chat_categories(chat))
    buttons = [{"text": ("✅ " if code in selected else "") + label, "callback_data": f"r:c:{code}"}
               for code, label in CATEGORY_BUTTONS]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([{"text": ("✅ " if not selected else "") + "✨ Все категории", "callback_data": "r:all"}])
    budget = f"от {money(chat.min_budget)}" if chat.min_budget else "любой"
    rows.append([{"text": f"💰 Бюджет: {budget}", "callback_data": "r:b"},
                 {"text": f"📍 {short(chat.city, 14) if chat.city else 'Любой город'}", "callback_data": "r:city"}])
    rows.append([{"text": "🔕 Выключить радар" if chat.radar_enabled else "🔔 Включить радар",
                  "callback_data": "r:off" if chat.radar_enabled else "r:on"}])
    return {"inline_keyboard": rows}


def budget_keyboard(chat: TelegramChat) -> dict:
    buttons = [{"text": ("✅ " if (chat.min_budget or 0) == amount else "") +
                        (f"от {money(amount)}" if amount else "Любой"),
                "callback_data": f"r:b:{amount}"} for amount in BUDGET_CHOICES]
    rows = [buttons[i:i + 3] for i in range(0, len(buttons), 3)]
    rows.append([{"text": "← Назад", "callback_data": "r:back"}])
    return {"inline_keyboard": rows}


def notify_view(chat: TelegramChat, user: Optional[User]) -> Tuple[str, dict]:
    if user is None:
        text = (
            "🔔 <b>Уведомления с сайта</b>\n\n"
            "Подключите аккаунт ДЕЛО — и сюда будут приходить отклики, сообщения, оплата и "
            "статусы сделок.\n\nНа сайте: «Профиль → Настройки → Подключить Telegram»."
        )
        url = site_url("/profile?tab=settings")
        return text, ({"inline_keyboard": [[{"text": "Подключить на сайте", "url": url}]]} if url else None)
    state = "включены" if chat.notify_enabled else "выключены"
    text = (
        f"🔔 <b>Уведомления {state}</b>\n\n"
        f"Аккаунт: <b>{escape(user.name or masked_email(user.email))}</b>\n"
        "Приходят: отклики, назначение исполнителем, сообщения, оплата, споры и заказы. "
        "Сообщения чата не дублируются, пока вы на сайте."
    )
    rows = [[{"text": "🔕 Выключить" if chat.notify_enabled else "🔔 Включить",
              "callback_data": "n:off" if chat.notify_enabled else "n:on"}],
            [{"text": "Отвязать аккаунт", "callback_data": "n:unlink"}]]
    return text, {"inline_keyboard": rows}
