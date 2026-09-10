# -*- coding: utf-8 -*-
"""
Телеграм-бот ДЕЛО — умный «Радар заказов» и мгновенные уведомления.

Команды:
  /start — подписаться на новые заказы / главное меню
  /radar — настроить фильтры радара (категории, минимальная цена, город)
  /my — текущие настройки радара
  /stop — отключить уведомления

Подписки хранятся в файле subscriptions.json (структурированный словарь с фильтрами).
"""
import json
import os
import time
import urllib.request
import urllib.error
from html import escape as _html_escape

BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
API_BASE = os.environ.get("API_URL", "https://delos-backend.onrender.com").rstrip("/")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://delo-jhcy.onrender.com").rstrip("/")
SUBS_FILE = os.environ.get("SUBS_FILE", "subscriptions.json")

CATEGORIES = {
    "design": "🎨 Дизайн",
    "development": "💻 Разработка",
    "writing": "✍️ Тексты",
    "repairs": "🔧 Ремонт",
    "cleaning": "🧹 Уборка",
    "delivery": "🚚 Доставка",
    "photo_video": "📷 Фото/Видео",
    "tutoring": "📚 Репетиторство",
    "beauty": "💄 Красота",
    "events": "🎉 Мероприятия",
    "business": "💼 Бизнес",
    "other": "📦 Другое",
}


def tg(method, _http_timeout=15, **params):
    """Выполняет запрос к Telegram Bot API с безопасной обработкой сетевых и HTTP ошибок."""
    if not BOT_TOKEN:
        return {"ok": False, "description": "No bot token"}
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    data = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=_http_timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
            parsed = json.loads(error_body)
            return parsed
        except Exception:
            return {"ok": False, "error_code": e.code, "description": str(e)}
    except urllib.error.URLError as e:
        return {"ok": False, "description": f"URLError: {e.reason}"}
    except Exception as e:
        return {"ok": False, "description": f"Unexpected error: {str(e)}"}


def load_subs():
    """
    Загружает словарь подписок {str(chat_id): {
        'enabled': True,
        'categories': ['repairs', 'cleaning'] or [],
        'min_budget': 0,
        'city': ''
    }}
    """
    try:
        if not os.path.exists(SUBS_FILE):
            return {}
        with open(SUBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Миграция старого формата [123, 456] в словарь
            if isinstance(data, list):
                migrated = {}
                for cid in data:
                    migrated[str(cid)] = {
                        "enabled": True,
                        "categories": [],
                        "min_budget": 0,
                        "city": ""
                    }
                return migrated
            if isinstance(data, dict):
                return data
            return {}
    except Exception as e:
        print(f"load_subs error: {e}")
        return {}


def save_subs(subs):
    """Атомарная запись файла подписок во избежание повреждения данных при сбоях."""
    tmp_file = f"{SUBS_FILE}.tmp"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(subs, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, SUBS_FILE)
    except Exception as e:
        print(f"save_subs error: {e}")
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except Exception:
                pass


def get_user_sub(chat_id):
    subs = load_subs()
    cid = str(chat_id)
    if cid not in subs or not isinstance(subs[cid], dict):
        subs[cid] = {
            "enabled": True,
            "categories": [],  # пусто = все категории
            "min_budget": 0,
            "city": ""
        }
        save_subs(subs)
    return subs[cid]


def fetch_new_tasks(last_id):
    """Возвращает заказы с id больше last_id."""
    try:
        req = urllib.request.Request(
            f"{API_BASE}/tasks/",
            headers={"User-Agent": "DeloTelegramBot/2.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            tasks = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print("tasks fetch error:", e)
        return [], last_id
        
    if not isinstance(tasks, list) or not tasks:
        return [], last_id
        
    max_id = max((t.get("id", 0) for t in tasks if isinstance(t, dict)), default=0)
    if last_id is None:
        return [], max_id  # при старте запоминаем текущий максимум
        
    fresh = [t for t in tasks if isinstance(t, dict) and t.get("id", 0) > last_id]
    return fresh, max_id


def task_matches_sub(task, sub):
    if not isinstance(sub, dict) or not sub.get("enabled", True):
        return False
    
    # Фильтр по минимальному бюджету
    try:
        task_budget = float(task.get("budget") or 0)
    except (ValueError, TypeError):
        task_budget = 0.0
        
    try:
        min_budget = float(sub.get("min_budget") or 0)
    except (ValueError, TypeError):
        min_budget = 0.0
        
    if min_budget > 0 and task_budget < min_budget:
        return False
    
    # Фильтр по категориям
    cats = sub.get("categories") or []
    if cats:
        if cats == ["__none__"]:
            return False
        if task.get("category") not in cats:
            return False
    
    # Фильтр по городу (если указан в подписке и заказ не удаленный)
    sub_city = (sub.get("city") or "").strip().lower()
    if sub_city and not task.get("is_remote", False):
        task_city = (task.get("city") or "").strip().lower()
        if sub_city not in task_city:
            return False
            
    return True


def notify_matching(task):
    cat_code = task.get("category", "other")
    cat = CATEGORIES.get(cat_code, cat_code)
    is_remote = task.get("is_remote", False)
    place = "🌐 Удалённо" if is_remote else (f"📍 {task.get('city') or 'Не указан'}" + (f", {task.get('address')}" if task.get('address') else ""))
    
    title = _html_escape(str(task.get("title", "")))
    cat_label = _html_escape(str(cat))
    place_label = _html_escape(place)
    
    try:
        budget = float(task.get('budget') or 0)
        budget_str = f"{budget:,.0f} ₽".replace(",", " ")
    except Exception:
        budget_str = "Договорная"
        
    task_id = task.get('id', 0)
    task_url = f"{FRONTEND_URL}/task/{task_id}"

    text = (
        f"🎯 <b>Новый заказ на ДЕЛО</b>\n\n"
        f"<b>{title}</b>\n"
        f"📂 Категория: {cat_label}\n"
        f"{place_label}\n"
        f"💰 <b>Бюджет: {budget_str}</b>\n\n"
    )
    
    # Кнопки быстрого действия (включая WebApp для Telegram Mini App)
    reply_markup = {
        "inline_keyboard": [
            [
                {
                    "text": "📱 Открыть в Telegram",
                    "web_app": {"url": task_url}
                },
                {
                    "text": "🌐 В браузере",
                    "url": task_url
                }
            ],
            [
                {
                    "text": "⚙️ Настроить радар",
                    "callback_data": "radar_menu"
                }
            ]
        ]
    }

    subs = load_subs()
    for cid, sub in list(subs.items()):
        if task_matches_sub(task, sub):
            res = tg("sendMessage", chat_id=cid, text=text, parse_mode="HTML",
                     reply_markup=reply_markup, disable_web_page_preview=True)
            if not res.get("ok"):
                error_code = res.get("error_code")
                desc = res.get("description", "").lower()
                # Если пользователь заблокировал бота или чат удален — отключаем подписку
                if error_code == 403 or "blocked" in desc or "not found" in desc or "deactivated" in desc:
                    print(f"User {cid} blocked the bot or chat lost. Disabling radar.")
                    sub["enabled"] = False
                    subs[cid] = sub
                    save_subs(subs)
                else:
                    print(f"send to {cid} failed: {res}")


def get_radar_keyboard(sub):
    current_cats = set(sub.get("categories", []))
    buttons = []
    
    # Категории по 2 в ряд
    cat_items = list(CATEGORIES.items())
    for i in range(0, len(cat_items), 2):
        row = []
        for key, name in cat_items[i:i+2]:
            is_active = key in current_cats
            prefix = "✅ " if is_active else "▫️ "
            row.append({
                "text": f"{prefix}{name}",
                "callback_data": f"toggle_cat:{key}"
            })
        buttons.append(row)
        
    buttons.append([
        {"text": "✨ Выбрать все категории", "callback_data": "cat_all"},
        {"text": "🧹 Сбросить всё", "callback_data": "cat_clear"}
    ])
    
    min_b = sub.get("min_budget", 0)
    buttons.append([
        {"text": f"💵 Мин. цена: {min_b or 'Любая'} ₽", "callback_data": "set_min_budget"},
        {"text": "📱 Открыть приложение", "web_app": {"url": FRONTEND_URL}}
    ])
    
    status_text = "🔔 Радар включён" if sub.get("enabled", True) else "🔕 Радар выключен"
    status_cb = "radar_off" if sub.get("enabled", True) else "radar_on"
    buttons.append([
        {"text": status_text, "callback_data": status_cb}
    ])
    
    return {"inline_keyboard": buttons}


def handle_callback_query(upd):
    cq = upd.get("callback_query")
    if not cq:
        return
    cb_id = cq.get("id")
    msg = cq.get("message")
    if not msg or "chat" not in msg:
        return
    chat_id = str(msg["chat"]["id"])
    msg_id = msg.get("message_id")
    data = cq.get("data", "")
    
    subs = load_subs()
    if chat_id not in subs or not isinstance(subs[chat_id], dict):
        subs[chat_id] = {"enabled": True, "categories": [], "min_budget": 0, "city": ""}
    sub = subs[chat_id]
    
    if data.startswith("toggle_cat:"):
        cat_key = data.split(":", 1)[1]
        cats = sub.get("categories", [])
        if cats == ["__none__"]:
            cats = []
        if cat_key in cats:
            cats.remove(cat_key)
        else:
            cats.append(cat_key)
        sub["categories"] = cats
        save_subs(subs)
        
        tg("answerCallbackQuery", callback_query_id=cb_id, text="Категория обновлена")
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg_id, reply_markup=get_radar_keyboard(sub))
        
    elif data == "cat_all":
        sub["categories"] = []  # пустой список = все категории
        save_subs(subs)
        tg("answerCallbackQuery", callback_query_id=cb_id, text="Выбраны все категории")
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg_id, reply_markup=get_radar_keyboard(sub))
        
    elif data == "cat_clear":
        sub["categories"] = ["__none__"]  # маркер "ничего"
        save_subs(subs)
        tg("answerCallbackQuery", callback_query_id=cb_id, text="Категории очищены")
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg_id, reply_markup=get_radar_keyboard(sub))
        
    elif data in ("radar_on", "radar_off"):
        sub["enabled"] = (data == "radar_on")
        save_subs(subs)
        tg("answerCallbackQuery", callback_query_id=cb_id, text="Статус радара изменён")
        tg("editMessageReplyMarkup", chat_id=chat_id, message_id=msg_id, reply_markup=get_radar_keyboard(sub))
        
    elif data == "set_min_budget":
        tg("answerCallbackQuery", callback_query_id=cb_id)
        tg("sendMessage", chat_id=chat_id, 
           text="Отправьте минимальную сумму заказа в рублях (например: <code>1500</code> или <code>0</code> для всех):", 
           parse_mode="HTML")
           
    elif data == "radar_menu":
        tg("answerCallbackQuery", callback_query_id=cb_id)
        send_radar_menu(chat_id)


def send_radar_menu(chat_id):
    sub = get_user_sub(chat_id)
    cats = sub.get("categories", [])
    if not cats:
        cats_label = "Все категории (без ограничений)"
    elif cats == ["__none__"]:
        cats_label = "Ни одной категории не выбрано"
    else:
        cats_label = ", ".join(CATEGORIES.get(c, c) for c in cats)
        
    text = (
        f"🎯 <b>Настройка «Радара заказов» ДЕЛО</b>\n\n"
        f"Здесь вы можете выбрать интересные категории и параметры, чтобы получать заказы первыми:\n\n"
        f"📂 <b>Категории:</b> {_html_escape(cats_label)}\n"
        f"💰 <b>Мин. цена:</b> {sub.get('min_budget', 0)} ₽\n"
        f"🔔 <b>Статус:</b> {'Включен' if sub.get('enabled', True) else 'Выключен'}\n\n"
        f"<i>Нажимайте на кнопки ниже для переключения:</i>"
    )
    tg("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML", reply_markup=get_radar_keyboard(sub))


def handle_update(upd):
    if "callback_query" in upd:
        handle_callback_query(upd)
        return
        
    msg = upd.get("message") or upd.get("channel_post")
    if not msg:
        return
    chat_id = msg.get("chat", {}).get("id")
    if not chat_id:
        return
    text = (msg.get("text") or "").strip()
    subs = load_subs()
    
    # Проверка на ввод числа (минимальный бюджет)
    if text.isdigit():
        sub = get_user_sub(chat_id)
        sub["min_budget"] = int(text)
        subs[str(chat_id)] = sub
        save_subs(subs)
        tg("sendMessage", chat_id=chat_id, 
           text=f"✅ Минимальный бюджет заказа установлен на <b>{int(text)} ₽</b>.",
           parse_mode="HTML")
        send_radar_menu(chat_id)
        return
        
    cmd = text.lower()
    if cmd.startswith("/start"):
        sub = get_user_sub(chat_id)
        sub["enabled"] = True
        subs[str(chat_id)] = sub
        save_subs(subs)
        
        reply_markup = {
            "keyboard": [
                [{"text": "🎯 Радар заказов"}, {"text": "📱 Открыть приложение", "web_app": {"url": FRONTEND_URL}}],
                [{"text": "📋 Мои настройки"}, {"text": "🛑 Отключить радар"}]
            ],
            "resize_keyboard": True
        }
        
        tg("sendMessage", chat_id=chat_id,
           text=f"👋 <b>Добро пожаловать в сервис ДЕЛО!</b>\n\n"
                f"«Радар заказов» активирован. Вы будете мгновенно получать уведомления о новых заказах прямо в Telegram.\n\n"
                f"⚙️ <b>/radar</b> — настроить категории и фильтры\n"
                f"🛑 <b>/stop</b> — приостановить уведомления",
           parse_mode="HTML", reply_markup=reply_markup)
           
    elif cmd.startswith("/radar") or cmd == "🎯 радар заказов":
        send_radar_menu(chat_id)
        
    elif cmd.startswith("/my") or cmd == "📋 мои настройки":
        send_radar_menu(chat_id)
        
    elif cmd.startswith("/stop") or cmd == "🛑 отключить радар":
        sub = get_user_sub(chat_id)
        sub["enabled"] = False
        subs[str(chat_id)] = sub
        save_subs(subs)
        tg("sendMessage", chat_id=chat_id, text="🔕 Радар заказов приостановлен. Напишите /start или /radar, чтобы включить снова.")


def start_health_server():
    """Render требует открытый порт у web-сервиса — отдаём простой health-check."""
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import threading
    port = int(os.environ.get("PORT", "10000"))

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("ДЕЛО бот и Радар заказов работают".encode("utf-8"))

        def log_message(self, *a):
            pass

    try:
        server = HTTPServer(("0.0.0.0", port), H)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"Health server started on port {port}")
    except Exception as e:
        print(f"Health server start failed: {e}")


def main():
    if not BOT_TOKEN:
        print("TG_BOT_TOKEN не задан — бот ожидает токен")
        # Все равно запускаем health server для Render
        start_health_server()
        while True:
            time.sleep(60)
        return

    start_health_server()
    try:
        tg("deleteWebhook", drop_pending_updates=False)
    except Exception as e:
        print("deleteWebhook error:", e)

    print("Bot and Order Radar started, polling...")
    offset = None
    last_task_id = None
    POLL_TIMEOUT = 25
    while True:
        try:
            params = {"timeout": POLL_TIMEOUT}
            if offset is not None:
                params["offset"] = offset
            result = tg("getUpdates", _http_timeout=POLL_TIMEOUT + 10, **params)
            for upd in result.get("result", []):
                offset = upd["update_id"] + 1
                handle_update(upd)
        except Exception as e:
            print("poll error:", e)
            time.sleep(3)

        fresh, new_max = fetch_new_tasks(last_task_id)
        if last_task_id is not None and fresh:
            for task in fresh:
                try:
                    notify_matching(task)
                except Exception as e:
                    print("notify error:", e)
        last_task_id = new_max
        time.sleep(1)


if __name__ == "__main__":
    main()
