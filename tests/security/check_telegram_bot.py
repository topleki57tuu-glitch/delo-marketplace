"""
Регресс: Telegram-бот (backend/app/telegram) и привязка аккаунта (app/api/telegram.py).

Запуск (из корня репозитория):
    python tests/security/check_telegram_bot.py

Коды возврата: 0 — всё сходится, 1 — есть расхождения.

Что проверяется и почему
------------------------
Прежний бот хранил подписки в файле внутри контейнера (обнулялись при каждом
пересоздании), не знал об аккаунтах сайта, а /stop оставлял chat_id. Новый
бот живёт на той же базе, что и сайт, поэтому здесь проверяется то, что
снаружи не видно, пока не сломается:

  1. ссылка привязки одноразовая, живёт 15 минут, в базе — только хэш;
  2. личные уведомления приходят один раз и только после привязки, сообщения
     одного чата сделки склеиваются, пока человек на сайте — молчим;
  3. в Telegram не уходят чужой email и точный адрес задания;
  4. радар уважает категорию, бюджет и город, своё задание не присылает,
     после сбоя Telegram продолжает рассылку без дублей;
  5. /stop и блокировка бота удаляют данные чата;
  6. API требует вход и CSRF-токен.

Сеть не нужна: client.call подменяется записью вызовов.
"""
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

HEARTBEATS = tempfile.mkdtemp(prefix="delo-bot-hb-")
# Кириллический домен — как в проде: кнопки Bot API принимают только ASCII.
isolate_env(
    "check_telegram_bot",
    FRONTEND_URL="https://дело.online",
    CORS_ORIGINS="https://дело.online",
    TELEGRAM_BOT_TOKEN="123456:fake-token-for-tests",
    TELEGRAM_BOT_USERNAME="delo_test_bot",
    TELEGRAM_HEARTBEAT_DIR=HEARTBEATS,
)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.api import telegram as telegram_api  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.csrf import verify_csrf  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import (  # noqa: E402
    Notification, Task, TaskCategory, TaskStatus, TelegramChat, TelegramLinkToken, User, UserRole,
)
from app.telegram import bot, client, core, health  # noqa: E402
from app.telegram.client import TelegramError  # noqa: E402

passed = 0
failed = 0


def utcnow() -> datetime:
    # Модели хранят naive UTC (default=datetime.utcnow).
    return datetime.now(timezone.utc).replace(tzinfo=None)


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


# --- поддельный Bot API ------------------------------------------------------------

calls = []        # все попытки: (method, params)
delivered = []    # успешно «доставленные» sendMessage
fail_for = {}     # chat_id -> [TelegramError, ...] — ошибки по очереди


def fake_call(method, http_timeout=15, **params):
    calls.append((method, params))
    if method == "getMe":
        return {"id": 1, "is_bot": True, "username": "delo_test_bot"}
    if method == "sendMessage":
        queue = fail_for.get(params.get("chat_id"))
        if queue:
            raise queue.pop(0)
        delivered.append(params)
        return {"message_id": len(delivered)}
    return True


client.call = fake_call


def sent_to(chat_id):
    return [p for p in delivered if p.get("chat_id") == chat_id]


def buttons(params):
    markup = params.get("reply_markup") or {}
    return [b for row in markup.get("inline_keyboard", []) for b in row]


def private(chat_id, text):
    return {"update_id": 1, "message": {"message_id": 1, "text": text,
                                        "chat": {"id": chat_id, "type": "private"}}}


def press(chat_id, data, message_id=50):
    return {"update_id": 2, "callback_query": {
        "id": f"cb-{data}", "data": data,
        "message": {"message_id": message_id, "chat": {"id": chat_id, "type": "private"}}}}


def run(update):
    db = SessionLocal(expire_on_commit=False)
    try:
        bot.handle_update(db, update)
    finally:
        db.close()


def deliver(**kwargs):
    db = SessionLocal(expire_on_commit=False)
    try:
        return bot.deliver(db, pace=0, **kwargs)
    finally:
        db.close()


def chat_row(chat_id):
    db = SessionLocal()
    try:
        return db.get(TelegramChat, chat_id)
    finally:
        db.close()


def add(*objects):
    db = SessionLocal(expire_on_commit=False)
    try:
        db.add_all(objects)
        db.commit()
        return objects
    finally:
        db.close()


def set_user(user_id, **values):
    db = SessionLocal()
    try:
        db.query(User).filter(User.id == user_id).update(values)
        db.commit()
    finally:
        db.close()


# --- данные --------------------------------------------------------------------------

Base.metadata.create_all(bind=engine)
anna, spec = add(
    User(email="anna@check.ru", name="Анна", hashed_password="x", role=UserRole.customer),
    User(email="spec.secret@check.ru", name=None, hashed_password="x", role=UserRole.specialist),
)
api = TestClient(main.app, raise_server_exceptions=False)


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def start_param(url):
    return url.split("?start=", 1)[1]


# Уведомление до привязки: прийти не должно.
add(Notification(user_id=spec.id, type="payment", title="Старое", text="до привязки"))

print("\n=== 1. Сайт: имя бота, вход, CSRF ===")
info = api.get("/telegram/info").json()
check("GET /telegram/info: бот включён и ведёт в радар",
      info == {"enabled": True, "username": "delo_test_bot", "url": "https://t.me/delo_test_bot?start=radar"},
      str(info))
check("GET /telegram/status без входа — 401", api.get("/telegram/status").status_code == 401)
check("POST /telegram/link без входа — 401", api.post("/telegram/link").status_code == 401)
# Смотрим маршруты самого роутера: с FastAPI 0.16x подключённые роутеры лежат
# в app.routes обёртками, а не плоским списком. Что роутер подключён к
# приложению, видно и по живым запросам выше.
csrf_routes = [r for r in telegram_api.router.routes if getattr(r, "path", "") == "/telegram/link"]
check("POST и DELETE /telegram/link защищены verify_csrf",
      len(csrf_routes) == 2 and all(verify_csrf in [d.call for d in r.dependant.dependencies] for r in csrf_routes))
settings.CSRF_ENABLED = True
try:
    code = api.post("/telegram/link", headers=auth(spec)).status_code
finally:
    settings.CSRF_ENABLED = False
check("POST /telegram/link без CSRF-заголовка при включённой защите — 403", code == 403, f"код {code}")

os.environ.pop("TELEGRAM_BOT_USERNAME")
telegram_api._cache.update(username=None, until=0.0)
before = len([c for c in calls if c[0] == "getMe"])
names = [telegram_api.bot_username(), telegram_api.bot_username()]
check("без TELEGRAM_BOT_USERNAME имя берётся из getMe и кэшируется",
      names == ["delo_test_bot"] * 2 and len([c for c in calls if c[0] == "getMe"]) == before + 1)
token_backup = os.environ.pop("TELEGRAM_BOT_TOKEN")
telegram_api._cache.update(username=None, until=0.0)
check("без токена бота сайт честно говорит «выключен»",
      api.get("/telegram/info").json()["enabled"] is False)
check("без токена ссылку привязки не выдают — 503",
      api.post("/telegram/link", headers=auth(spec)).status_code == 503)
os.environ["TELEGRAM_BOT_TOKEN"] = token_backup
os.environ["TELEGRAM_BOT_USERNAME"] = "delo_test_bot"

print("\n=== 2. Привязка аккаунта ===")
first = api.post("/telegram/link", headers=auth(spec)).json()
second = api.post("/telegram/link", headers=auth(spec)).json()
param1, param2 = start_param(first["url"]), start_param(second["url"])
check("ссылка ведёт к боту с link_-токеном и живёт 15 минут",
      second["url"].startswith("https://t.me/delo_test_bot?start=link_") and second["expires_in"] == 900)
check("параметр start укладывается в 64 символа", len(param2) <= 64, f"{len(param2)} символов")
db = SessionLocal()
stored = [row.token_hash for row in db.query(TelegramLinkToken).all()]
db.close()
check("в базе только хэш и только последней ссылки",
      len(stored) == 1 and param2[len("link_"):] not in stored[0])

run(private(1001, f"/start {param1}"))
check("прежняя ссылка после выдачи новой не работает, чат по ней не заводится",
      chat_row(1001) is None and core.LINK_FAILED_TEXT in sent_to(1001)[-1]["text"])
run(private(1001, f"/start {param2}"))
row = chat_row(1001)
check("по ссылке чат привязан к аккаунту", row.user_id == spec.id and row.notify_enabled)
check("пришедшему за уведомлениями радар не включается сам",
      row.radar_enabled is False and "/radar" in sent_to(1001)[-1]["text"])
check("в ответе маска email, а не сам адрес",
      "s***@check.ru" in sent_to(1001)[-1]["text"] and "spec.secret@" not in sent_to(1001)[-1]["text"])
run(private(1002, f"/start {param2}"))
check("ссылка одноразовая: второй чат по ней не привязать", chat_row(1002) is None)

db = SessionLocal()
raw = core.create_link_token(db, anna.id)
db.query(TelegramLinkToken).update({"expires_at": utcnow() - timedelta(minutes=1)})
db.commit()
db.close()
run(private(2001, "/start"))
check("обычный /start: радар включён сразу", chat_row(2001).radar_enabled is True)
run(private(2001, f"/start link_{raw}"))
check("просроченная ссылка не привязывает", chat_row(2001).user_id is None)
db = SessionLocal()
raw_a = core.create_link_token(db, anna.id)
raw_b = core.create_link_token(db, anna.id)
db.close()
run(private(2001, f"/start link_{raw_a}"))
check("ссылка гаснет, когда выдана новая", chat_row(2001).user_id is None)
run(private(2001, f"/start link_{raw_b}"))
db = SessionLocal()
raw_c = core.create_link_token(db, anna.id)
db.close()
run(private(2002, f"/start link_{raw_c}"))
check("повторная привязка переносит аккаунт в новый чат",
      chat_row(2001).user_id is None and chat_row(2002).user_id == anna.id)
status = api.get("/telegram/status", headers=auth(spec)).json()
check("GET /telegram/status видит привязку",
      status["linked"] is True and status["notify_enabled"] is True and status["username"] == "delo_test_bot",
      str(status))
run({"update_id": 3, "message": {"message_id": 1, "text": "/start", "chat": {"id": -100500, "type": "group"}}})
check("группы бот игнорирует: ни ответа, ни записи", not sent_to(-100500) and chat_row(-100500) is None)

print("\n=== 3. Личные уведомления ===")
# Запросы к API выше отметили пользователей онлайн (track_last_seen).
set_user(spec.id, last_seen=None)
set_user(anna.id, last_seen=None)
add(*[Notification(user_id=spec.id, type="message", title="Новое сообщение", task_id=5,
                   text=f"anna@check.ru: <b>привет</b> & пока {i}") for i in range(3)])
add(Notification(user_id=spec.id, type="payment", title="Оплата <получена>", text="+500 ₽"))
mark = len(sent_to(1001))
stats = deliver()
fresh = sent_to(1001)[mark:]
check("до привязки — ничего, после — два сообщения (3 сообщения чата склеены)",
      len(fresh) == 2 and stats["notifications"] == 2, str(stats))
chat_msg = fresh[0]["text"] if fresh else ""
check("склеенные сообщения помечены количеством", "(3)" in chat_msg)
check("чужой email в Telegram не уходит", "anna@check.ru" not in chat_msg and "a***@check.ru" in chat_msg)
check("HTML из текста экранирован", "&lt;b&gt;привет&lt;/b&gt; &amp; пока 2" in chat_msg)
check("кнопка ведёт в переписку по punycode-адресу",
      fresh and buttons(fresh[0])[0]["url"] == "https://xn--d1acsm.online/chats?taskId=5")
check("оплата ведёт в кошелёк, заголовок экранирован",
      len(fresh) > 1 and buttons(fresh[1])[0]["url"] == "https://xn--d1acsm.online/profile?tab=wallet"
      and "Оплата &lt;получена&gt;" in fresh[1]["text"])
check("повторный проход ничего не дублирует", deliver()["notifications"] == 0)

set_user(spec.id, last_seen=utcnow())
add(Notification(user_id=spec.id, type="message", title="Новое сообщение", task_id=5, text="Анна: тут?"),
    Notification(user_id=spec.id, type="response_accepted", title="Вас выбрали", task_id=5, text="Задача"))
mark = len(sent_to(1001))
stats = deliver()
fresh = sent_to(1001)[mark:]
check("на сайте онлайн: сообщения чата не дублируются в Telegram, прочее приходит",
      len(fresh) == 1 and "Вас выбрали" in fresh[0]["text"] and stats["skipped"] == 1, str(stats))
set_user(spec.id, last_seen=None)

run(press(1001, "n:off"))
add(Notification(user_id=spec.id, type="payment", title="Пока выключено", text="x"))
check("выключенные уведомления не приходят", deliver()["notifications"] == 0)
time.sleep(0.01)
run(press(1001, "n:on"))
check("после включения накопленное не присылается", deliver()["notifications"] == 0)
add(Notification(user_id=spec.id, type="payment", title="Новое после включения", text="x"))
fail_for[1001] = [TelegramError(0, "нет связи с Telegram")]
check("сбой сети: уведомление не потеряно и не отмечено", deliver()["notifications"] == 0)
mark = len(sent_to(1001))
deliver()
check("со следующего прохода оно приходит ровно один раз",
      [("Новое после включения" in p["text"]) for p in sent_to(1001)[mark:]] == [True])

add(Notification(user_id=anna.id, type="new_response", title="Новый отклик", task_id=7, text="x"))
fail_for[2002] = [TelegramError(403, "Forbidden: bot was blocked by the user")]
deliver()
check("бота заблокировали — чат и привязка удалены", chat_row(2002) is None)

print("\n=== 4. Радар заказов ===")
run(private(3001, "/start radar"))
check("/start radar: приветствие и меню радара", len(sent_to(3001)) == 2
      and "Радар" in sent_to(3001)[1]["text"])
for data in ("r:c:development", "r:b:3000", "r:city"):
    run(press(3001, data))
run(private(3001, "Казань"))
row = chat_row(3001)
check("фильтры из кнопок сохранились",
      row.categories == "development" and row.min_budget == 3000 and row.city == "Казань" and row.awaiting is None,
      f"{row.categories!r} {row.min_budget} {row.city!r}")
check("каждое нажатие кнопки подтверждено", len([c for c in calls if c[0] == "answerCallbackQuery"]) >= 3)
run(press(3002, "r:b:777"))
check("бюджет не из списка не принимается", chat_row(3002).min_budget == 0)
run(press(3002, "r:off"))
check("радар выключается кнопкой", chat_row(3002).radar_enabled is False)

now = utcnow()
dev, design = TaskCategory.development, TaskCategory.design


def task(title, **kw):
    values = dict(title=title, description="Описание", category=dev, budget=5000, city="Казань",
                  is_remote=False, customer_id=anna.id, status=TaskStatus.open, created_at=now)
    values.update(kw)
    return Task(**values)


tasks = add(
    task("t1 <script>", address="ул. Секретная, 7"),
    task("t2", category=design),
    task("t3", budget=1000),
    task("t4", city="Москва"),
    task("t5", city="Москва", is_remote=True),
    task("t6", budget=None),
    task("t_old", created_at=now - timedelta(hours=3)),
    task("t_closed", status=TaskStatus.in_progress),
    task("t_own", customer_id=spec.id),
)
ids = {t.title.split()[0]: t.id for t in tasks}


def radar_ids(chat_id, start=0):
    found = []
    for params in sent_to(chat_id)[start:]:
        for b in buttons(params):
            url = b.get("url") or (b.get("web_app") or {}).get("url") or ""
            if "/tasks/" in url and b.get("url"):
                found.append(int(url.rsplit("/", 1)[1]))
    return found


run(press(1001, "r:on"))
check("радар включается кнопкой", chat_row(1001).radar_enabled is True)
marks = {c: len(sent_to(c)) for c in (1001, 2001, 3001, 3002)}
deliver()
by_name = {v: k for k, v in ids.items()}


def names_for(chat_id):
    return sorted(by_name[i] for i in radar_ids(chat_id, marks[chat_id]))


check("фильтры: категория, бюджет, город; удалённые — при любом городе",
      names_for(3001) == ["t1", "t5", "t_own"], str(names_for(3001)))
check("своё задание исполнителю не присылается, остальное — без фильтров",
      names_for(1001) == ["t1", "t2", "t3", "t4", "t5", "t6"], str(names_for(1001)))
check("выключенный радар молчит", names_for(3002) == [])
check("старые и уже взятые в работу задания не рассылаются",
      "t_old" not in names_for(2001) and "t_closed" not in names_for(2001), str(names_for(2001)))
t1_msg = next((p for p in sent_to(3001)[marks[3001]:] if f"/tasks/{ids['t1']}" in str(p)), {})
check("в радаре нет точного адреса", "Секретная" not in t1_msg.get("text", ""))
check("заголовок экранирован", "t1 &lt;script&gt;" in t1_msg.get("text", ""))
check("кнопки: Mini App и браузер, оба на punycode-адрес",
      [b.get("web_app", {}).get("url") or b.get("url") for b in buttons(t1_msg)][:2]
      == [f"https://xn--d1acsm.online/tasks/{ids['t1']}"] * 2)
check("повторный проход радара ничего не дублирует", deliver()["messages"] == 0)

(t7,) = add(task("t7"))
fail_for[3001] = [TelegramError(502, "Bad Gateway")]
marks = {c: len(sent_to(c)) for c in (1001, 2001, 3001)}
deliver()
deliver()
counts = {c: radar_ids(c, marks[c]).count(t7.id) for c in marks}
check("сбой посреди рассылки: каждый подписчик получил задание ровно один раз",
      counts == {1001: 1, 2001: 1, 3001: 1}, str(counts))

print("\n=== 5. Отключение и удаление данных ===")
resp = api.delete("/telegram/link", headers=auth(spec))
check("DELETE /telegram/link отвязывает аккаунт",
      resp.json() == {"unlinked": True} and chat_row(1001).user_id is None and chat_row(1001) is not None)
check("бот сообщает об отвязке в чат", telegram_api.UNLINKED_TEXT in sent_to(1001)[-1]["text"])
check("повторная отвязка — без ошибки", api.delete("/telegram/link", headers=auth(spec)).json() == {"unlinked": False})
check("после отвязки статус — не подключён",
      api.get("/telegram/status", headers=auth(spec)).json()["linked"] is False)
run(private(3001, "/stop"))
check("/stop удаляет чат вместе с фильтрами", chat_row(3001) is None)
check("/stop убирает клавиатуру бота", sent_to(3001)[-1]["reply_markup"] == {"remove_keyboard": True})

print("\n=== 6. Проверка живости (healthcheck) ===")
check("без отметок потоков — нездоров", health.main() == 1)
bot._heartbeat("updates")
bot._heartbeat("delivery")
check("свежие отметки обоих потоков — здоров", health.main() == 0)
old = time.time() - health.MAX_AGE - 5
os.utime(os.path.join(HEARTBEATS, "delo-bot-delivery"), (old, old))
check("завис поток рассылки — нездоров", health.main() == 1)

print(f"\nИтого: {passed} OK, {failed} FAIL")
sys.exit(1 if failed else 0)
