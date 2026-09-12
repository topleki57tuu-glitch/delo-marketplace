#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Демо-данные для маркетплейса «ДЕЛО» (dev-режим, SQLite).

Запуск (из каталога backend):
    python3 seed_demo.py

Полностью очищает dev-базу и создаёт:
  * 3 заказчиков + 5 специалистов (у всех пароль: demo123)
  * 13 заданий по всем категориям (открытые / в работе / завершённые)
  * отклики, переписки, отзывы, уведомления, транзакции (эскроу, PRO)
"""
import sys
from datetime import datetime, timedelta

sys.path.insert(0, ".")

from sqlalchemy import text

from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password, encrypt_sensitive
from app.models import (
    User, Task, Response, Message, Review, Notification, Transaction,
    UserRole, TaskStatus, TaskCategory, TransactionType,
    Dispute, DisputeStatus, WithdrawalRequest, WithdrawalStatus,
)

NOW = datetime.utcnow()
PASSWORD = "demo123"
CITY = {
    "Москва": (55.751574, 37.573856),
    "Санкт-Петербург": (59.9343, 30.3351),
    "Казань": (55.8304, 49.0661),
}


def d(days):
    """Return datetime object (not ISO string)"""
    return NOW + timedelta(days=days)


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # ---------- Очистка ----------
    tables = [
        "messages", "reviews", "responses", "notifications", "transactions",
        "payment_records", "password_reset_tokens", "stored_files", "disputes",
        "verification_requests",
        "withdrawal_requests",
        "tasks", "users",
    ]
    for t in tables:
        db.execute(text(f'DELETE FROM "{t}"'))
    try:
        db.execute(text("DELETE FROM sqlite_sequence"))
    except Exception:
        pass
    db.commit()
    print("База очищена.")

    # ---------- Пользователи ----------
    users = {}

    def add_user(key, email, name, role, *, city=None, bio=None, skills=None,
                 balance=0, is_pro=False, pro_until=None, verified=False,
                 credits=5, last_seen_min=None):
        u = User(
            email=email,
            hashed_password=hash_password(PASSWORD),
            role=UserRole[role],
            name=name,
            bio=bio,
            city=city,
            balance=balance,
            is_pro=is_pro,
            pro_until=pro_until,
            verified=verified,
            response_credits=credits,
            last_seen=NOW - timedelta(minutes=last_seen_min) if last_seen_min is not None else None,
        )
        if skills:
            u.skills = "[" + ", ".join(f'"{s}"' for s in skills) + "]"
        db.add(u)
        users[key] = u
        return u

    # Заказчики
    add_user("anna", "anna@delo.ru", "Анна Смирнова", "customer",
             city="Москва", bio="Маркетолог, запускаю проекты в e-commerce.",
             balance=47000, last_seen_min=0)
    add_user("dmitry", "dmitry@delo.ru", "Дмитрий Орлов", "customer",
             city="Санкт-Петербург", bio="Владелец квартиры и небольшого кафе.",
             balance=80000, last_seen_min=70)
    add_user("olga", "olga@delo.ru", "Ольга Ковалёва", "customer",
             city="Казань", bio="Организую семейные праздники.",
             balance=10000, last_seen_min=180)
    # Арбитр платформы (email входит в ADMIN_EMAILS в .env)
    add_user("admin", "admin@delo.ru", "Арбитр ДЕЛО", "customer",
             city="Москва", bio="Служба арбитража платформы. Рассматриваю споры по безопасным сделкам.",
             balance=0, verified=True, last_seen_min=5)

    # Специалисты
    add_user("igor", "igor@delo.ru", "Игорь Волков", "specialist",
             city="Москва",
             bio="Fullstack-разработчик, 7 лет опыта. Telegram-боты, веб-сервисы, интеграции с платежами.",
             skills=["Python", "FastAPI", "React", "Node.js", "Telegram-боты"],
             balance=24410, is_pro=True, pro_until=d(30), verified=True,
             last_seen_min=0)
    add_user("maria", "maria@delo.ru", "Мария Соколова", "specialist",
             city="Москва",
             bio="Графический дизайнер. Логотипы, фирменные стили, реклама для соцсетей.",
             skills=["Figma", "Illustrator", "Photoshop", "Брендинг"],
             balance=7410, verified=True, credits=15, last_seen_min=25)
    add_user("alexey", "alexey@delo.ru", "Алексей Петров", "specialist",
             city="Санкт-Петербург",
             bio="Мастер по ремонту: сантехника, электрика, отделка «под ключ». Работаю по договору.",
             skills=["Сантехника", "Электрика", "Отделка", "Кухни на заказ"],
             last_seen_min=10)
    add_user("elena", "elena@delo.ru", "Елена Морозова", "specialist",
             city="Казань",
             bio="Профессиональный клининг: квартиры, офисы, послеремонтная уборка. Своя команда из 3 человек.",
             skills=["Клининг", "Химчистка", "Мытьё окон"],
             last_seen_min=120)
    add_user("sergey", "sergey@delo.ru", "Сергей Лебедев", "specialist",
             city="Москва",
             bio="Фотограф и видеограф. Съёмка свадеб, каталогов, репортаж. Полный цикл: съёмка + монтаж.",
             skills=["Фотосъёмка", "Видеосъёмка", "Монтаж", "Lightroom"],
             is_pro=True, pro_until=d(90), last_seen_min=5)

    db.flush()

    # ---------- Задания ----------
    tasks = {}

    def add_task(key, customer, title, description, *, category, budget=None,
                 city=None, address=None, remote=False, deadline=None,
                 status="open", executor=None, created_days_ago=0):
        lat, lon = (CITY.get(city) or (None, None)) if city else (None, None)
        if remote:
            lat = lon = None
        t = Task(
            title=title,
            description=description,
            budget=budget,
            category=TaskCategory[category],
            customer_id=users[customer].id,
            executor_id=users[executor].id if executor else None,
            status=TaskStatus[status],
            city=city,
            address=address,
            latitude=lat,
            longitude=lon,
            deadline=deadline,
            is_remote=remote,
        )
        db.add(t)
        tasks[key] = t
        return t

    add_task("t1", "anna",
             "Разработать интернет-магазин на React и Node.js",
             "Нужен интернет-магазин для доставки фермерских продуктов: каталог, корзина, "
             "оплата онлайн, личный кабинет покупателя.\n\nЕсть готовый дизайн в Figma. "
             "Дедлайн важен — запуск к сезону.",
             category="development", budget=60000, city="Москва", remote=True,
             deadline=d(14), created_days_ago=-2)

    add_task("t2", "anna",
             "Логотип и фирменный стиль для сети кофейень «Зерно»",
             "Требуется логотип, палитра, шрифты и шаблоны для стаканов/упаковки. "
             "Сеть из 4 кофеен, хочется тёплый «крафтовый» стиль.",
             category="design", budget=15000, city="Москва",
             deadline=d(10), created_days_ago=-3)

    add_task("t3", "dmitry",
             "Установить смеситель и заменить трубы под раковиной",
             "Протекает смеситель на кухне, старые трубы требуют замены. "
             "Сантехника новая есть, нужен мастер с инструментом.",
             category="repairs", budget=8000, city="Санкт-Петербург",
             address="ул. Рубинштейна, 5", deadline=d(3), created_days_ago=-1)

    add_task("t4", "olga",
             "Генеральная уборка трёхкомнатной квартиры после ремонта",
             "После косметического ремонта: пыль на всех поверхностях, следи краски на окнах. "
             "Нужны моющие средства и оборудование — у исполнителя.",
             category="cleaning", budget=5500, city="Казань",
             address="ул. Баумана, 44", deadline=d(2), created_days_ago=-1)

    add_task("t5", "anna",
             "Съёмка свадьбы — 8 часов, 2 оператора",
             "Свадьба на 60 человек, площадка в Подмосковье. Нужны фотограф + видеооператор "
             "на весь день, монтаж клипа 3–5 минут и 300 обработанных фото.",
             category="photo_video", budget=35000, city="Москва",
             deadline=d(30), created_days_ago=-4)

    add_task("t6", "olga",
             "Репетитор по математике: подготовка к ЕГЭ (онлайн)",
             "Ищу репетитора для сына (11 класс, профиль). Цель — 80+ баллов. "
             "Занятия 2 раза в неделю по 90 минут, платформа любая.",
             category="tutoring", budget=20000, remote=True,
             deadline=d(120), created_days_ago=-5)

    add_task("t7", "anna",
             "Курьер на день — доставка букетов по городу",
             "8 марта нужна доставка 30 букетов по Москве (в пределах МКАД). "
             "График с 9:00 до 20:00, оплата за день.",
             category="delivery", budget=3000, city="Москва",
             deadline=d(7), created_days_ago=-1)

    add_task("t8", "dmitry",
             "Тексты для сайта юридической фирмы (10 страниц)",
             "Нужны продающие тексты для 10 страниц сайта: услуги, о компании, кейсы. "
             "Тематика — банкротство физлиц. Опыт в юридических текстах обязателен.",
             category="writing", budget=12000, remote=True,
             deadline=d(21), created_days_ago=-6)

    add_task("t9", "olga",
             "Ведущий на юбилей (50 человек, банкет)",
             "Ищем ведущего на юбилей мужа: 50 гостей, банкетный зал в центре Казани. "
             "Программа, музыка, конкурсы. Тайминг 4 часа.",
             category="events", budget=25000, city="Казань",
             deadline=d(45), created_days_ago=-7)

    # Завершённые (с отзывами и выплатами эскроу)
    add_task("t10", "anna",
             "Telegram-бот для записи клиентов в барбершоп",
             "Нужен бот: каталог услуг, выбор мастера и времени, напоминания за 24 часа. "
             "Админка — Google-таблица.",
             category="development", budget=25000, city="Москва", remote=True,
             status="completed", executor="igor", created_days_ago=-20)

    add_task("t11", "anna",
             "Баннеры для рекламы в соцсетях (6 форматов)",
             "Сетка баннеров 6 форматов для таргета ВК и Яндекс.Директа. "
             "Адаптация под 2 оффера, исходники — Figma.",
             category="design", budget=8000, city="Москва", remote=True,
             status="completed", executor="maria", created_days_ago=-15)

    # В работе (эскроу заморожен, есть переписка)
    add_task("t12", "dmitry",
             "Ремонт кухни под ключ: демонтаж, электрика, отделка",
             "Кухня 9 м²: демонтаж старого гарнитура, замена проводки, выравнивание стен, "
             "укладка плитки и ламината, установка гарнитура (гарнитур уже куплен).",
             category="repairs", budget=150000, city="Санкт-Петербург",
             address="ул. Рубинштейна, 5", status="in_progress", executor="alexey",
             deadline=d(20), created_days_ago=-10)

    add_task("t13", "anna",
             "Предметная фотосъёмка для каталога одежды",
             "Каталог для интернет-магазина: 40 SKU, на белом фоне и на модели. "
             "Студия наша, нужна съёмка + базовая ретушь.",
             category="photo_video", budget=20000, city="Москва",
             status="in_progress", executor="sergey",
             deadline=d(7), created_days_ago=-3)

    db.flush()

    # ---------- Демо-спор (арбитраж) ----------
    # Заказ t13 (фотосъёмка каталога): исполнитель затягивает сдачу — заказчик открыл спор.
    task_t13 = tasks["t13"]
    task_t13.status = TaskStatus.disputed
    db.add(Dispute(
        task_id=task_t13.id,
        opened_by=users["anna"].id,
        reason="Исполнитель не выходит на связь третий день, материалы по первым 10 SKU не прислал, дедлайн срывается.",
    ))

    # ---------- Отклики ----------
    def add_resp(task, spec, text, price=None, days_=None):
        db.add(Response(
            task_id=tasks[task].id,
            specialist_id=users[spec].id,
            text=text,
            proposed_price=price,
            estimated_days=days_,
        ))

    add_resp("t1", "igor",
             "Сделаю магазин на React + Node.js с интеграцией ЮKassa. "
             "Похожий проект запускал в апреле — покажу. Уложусь в 2 недели.",
             price=58000, days_=14)
    add_resp("t2", "maria",
             "Специализируюсь на айдентике для кофеен и ресторанов. "
             "Сделаю логотип + гайдлайн 15 страниц, 3 варианта концепта.",
             price=15000, days_=6)
    add_resp("t3", "alexey",
             "Приеду завтра с 9:00, смеситель установлю, трубы заменю на полипропилен. "
             "Гарантия на работу 2 года.",
             price=7500, days_=1)
    add_resp("t4", "elena",
             "Команда из 3 человек, придём со своими средствами и оборудованием. "
             "Послеремонтная уборка — наша специализация, 4–5 часов работы.",
             price=5200, days_=1)
    add_resp("t5", "sergey",
             "Снимаем с ассистентом: 8 часов съёмки, клип 4 минуты, 300+ фото с ретушью. "
             "Весь материал — в течение 10 дней.",
             price=35000, days_=10)

    # ---------- Переписки (в работе) ----------
    def add_msg(task, sender, text, minutes_ago):
        db.add(Message(
            task_id=tasks[task].id,
            sender_id=users[sender].id,
            text=text,
            created_at=NOW - timedelta(minutes=minutes_ago),
        ))

    add_msg("t12", "dmitry", "Добрый день! Когда сможете начать?", 2880)
    add_msg("t12", "alexey", "Здравствуйте! Завтра в 10:00 приеду на замер, начнём в понедельник.", 2800)
    add_msg("t12", "dmitry", "Отлично. Ключи оставлю в консьерже, договоритесь с рабочими по времени.", 2700)
    add_msg("t12", "alexey", "Принято. Электрику согласовал с мастером, материал привезу сам по чекам.", 120)
    add_msg("t13", "anna", "Сергей, привет! Модель подтвердила четверг, студия с 10:00 свободна.", 2400)
    add_msg("t13", "sergey", "Привет! Отлично, приеду к 9:30 с оборудованием. Свет поставим на 2 схемы.", 2340)
    add_msg("t13", "sergey", "Первые 10 SKU отправлю вам на согласование в пятницу.", 300)

    # ---------- Отзывы ----------
    db.add(Review(task_id=tasks["t10"].id, reviewer_id=users["anna"].id,
                  specialist_id=users["igor"].id, rating=5, target="specialist",
                  comment="Сделал бота за неделю, всё работает без нареканий, правки вносил в тот же день. Рекомендую!"))
    db.add(Review(task_id=tasks["t10"].id, reviewer_id=users["igor"].id,
                  specialist_id=users["anna"].id, rating=5, target="customer",
                  comment="Чёткое ТЗ и быстрые ответы — работать одно удовольствие."))
    db.add(Review(task_id=tasks["t11"].id, reviewer_id=users["anna"].id,
                  specialist_id=users["maria"].id, rating=5, target="specialist",
                  comment="Баннеры супер, CTR кампании вырос почти в два раза. Вернусь ещё."))
    db.add(Review(task_id=tasks["t11"].id, reviewer_id=users["maria"].id,
                  specialist_id=users["anna"].id, rating=4, target="customer",
                  comment="Хороший заказчик, правки по существу. Единственное — согласование затянулось на пару дней."))

    # ---------- Транзакции ----------
    def add_tx(user, amount, type_, task=None, days_ago=0, fee=0):
        db.add(Transaction(
            user_id=users[user].id, amount=amount, type=TransactionType[type_],
            task_id=tasks[task].id if task else None,
            fee=fee,
            created_at=NOW - timedelta(days=days_ago),
        ))

    add_tx("anna", 100000, "deposit", days_ago=22)
    add_tx("dmitry", 230000, "deposit", days_ago=12)
    add_tx("olga", 10000, "deposit", days_ago=8)
    # t10: холд + выплата
    add_tx("anna", -25000, "escrow_hold", task="t10", days_ago=19)
    add_tx("igor", 25000, "escrow_release", task="t10", days_ago=6, fee=0)  # PRO: комиссия 0%
    # t11: холд + выплата
    add_tx("anna", -8000, "escrow_hold", task="t11", days_ago=14)
    add_tx("maria", 7600, "escrow_release", task="t11", days_ago=5, fee=400)  # 5% от 8000
    # t12, t13: заморожено, в работе
    add_tx("dmitry", -150000, "escrow_hold", task="t12", days_ago=9)
    add_tx("anna", -20000, "escrow_hold", task="t13", days_ago=2)
    # Монетизация
    add_tx("igor", -590, "purchase", days_ago=7)   # PRO на 1 месяц
    add_tx("maria", -190, "purchase", days_ago=6)  # +10 откликов

    # ---------- Уведомления ----------
    def add_notif(user, type_, title, text_, task=None, read=False, hours_ago=1):
        db.add(Notification(
            user_id=users[user].id, type=type_, title=title, text=text_,
            task_id=tasks[task].id if task else None, is_read=read,
            created_at=NOW - timedelta(hours=hours_ago),
        ))

    add_notif("anna", "new_response", "Новый отклик на заказ!",
              "PRO ★ Игорь Волков откликнулся на задачу «Разработать интернет-магазин на React и Node.js» — 58000 ₽",
              task="t1", hours_ago=20)
    add_notif("anna", "new_response", "Новый отклик на заказ!",
              "Мария Соколова откликнулась на задачу «Логотип и фирменный стиль для сети кофейень «Зерно»» — 15000 ₽",
              task="t2", hours_ago=40)
    add_notif("anna", "new_response", "Новый отклик на заказ!",
              "PRO ★ Сергей Лебедев откликнулся на задачу «Съёмка свадьбы — 8 часов, 2 оператора» — 35000 ₽",
              task="t5", hours_ago=70, read=True)
    add_notif("dmitry", "new_response", "Новый отклик на заказ!",
              "Алексей Петров откликнулся на задачу «Установить смеситель и заменить трубы под раковиной» — 7500 ₽",
              task="t3", hours_ago=12)
    add_notif("olga", "new_response", "Новый отклик на заказ!",
              "Елена Морозова откликнулась на задачу «Генеральная уборка трёхкомнатной квартиры» — 5200 ₽",
              task="t4", hours_ago=30)
    add_notif("alexey", "assigned", "Вас выбрали исполнителем!",
              "Заказчик назначил вас на задачу «Ремонт кухни под ключ: демонтаж, электрика, отделка»",
              task="t12", hours_ago=210, read=True)
    add_notif("sergey", "assigned", "Вас выбрали исполнителем!",
              "Заказчик назначил вас на задачу «Предметная фотосъёмка для каталога одежды»",
              task="t13", hours_ago=48)
    add_notif("igor", "completed", "Заказ завершён!",
              "Заказчик подтвердил выполнение «Telegram-бот для записи клиентов в барбершоп». 25000 ₽ переведены на ваш баланс.",
              task="t10", hours_ago=140, read=True)
    add_notif("maria", "completed", "Заказ завершён!",
              "Заказчик подтвердил выполнение «Баннеры для рекламы в соцсетях (6 форматов)». 7600 ₽ переведены на ваш баланс (комиссия платформы 5%: 400 ₽).",
              task="t11", hours_ago=110, read=True)
    add_notif("igor", "review", "Новый отзыв о вашей работе",
              "Анна Смирнова оценила вашу работу на 5 ⭐", task="t10", hours_ago=139)
    add_notif("sergey", "dispute", "Открыт спор по заказу",
              "Анна Смирнова открыла спор по заказу «Предметная фотосъёмка для каталога одежды». Средства заморожены до решения арбитража.",
              task="t13", hours_ago=6)

    # ---------- Заявки на вывод средств ----------
    def add_withdrawal(user, amount, method, requisites, status_, days_ago=0, comment=None):
        """Повторяет денежную логику API: при подаче заявки сумма списывается
        с баланса, при отклонении или отмене — возвращается."""
        owner = users[user]
        owner.balance -= amount
        db.add(Transaction(
            user_id=owner.id, amount=-amount, type=TransactionType.withdraw_hold,
            created_at=NOW - timedelta(days=days_ago),
        ))
        resolved = status_ != WithdrawalStatus.pending
        if status_ in (WithdrawalStatus.rejected, WithdrawalStatus.cancelled):
            owner.balance += amount
            db.add(Transaction(
                user_id=owner.id, amount=amount, type=TransactionType.withdraw_refund,
                created_at=NOW - timedelta(days=days_ago) + timedelta(hours=3),
            ))
        db.add(WithdrawalRequest(
            user_id=owner.id, amount=amount, method=method,
            requisites=encrypt_sensitive(requisites),
            status=status_, comment=comment,
            created_at=NOW - timedelta(days=days_ago),
            resolved_at=NOW - timedelta(days=days_ago) + timedelta(hours=3) if resolved else None,
        ))

    add_withdrawal("igor", 10000, "card", "4276 3800 1234 5678",
                   WithdrawalStatus.pending, days_ago=1)
    add_withdrawal("maria", 5000, "sbp", "+7 916 123-45-67",
                   WithdrawalStatus.paid, days_ago=9, comment="Выплачено по СБП")
    add_withdrawal("maria", 2000, "card", "4276 3800 8765 4321",
                   WithdrawalStatus.rejected, days_ago=15,
                   comment="Имя получателя не совпадает с владельцем счёта")

    db.commit()

    # ---------- Итоги ----------
    print("\n=== Демо-данные созданы ===")
    print(f"Пользователи: {db.query(User).count()} (пароль у всех: {PASSWORD})")
    print(f"Задания: {db.query(Task).count()} "
          f"(open={db.query(Task).filter(Task.status == TaskStatus.open).count()}, "
          f"in_progress={db.query(Task).filter(Task.status == TaskStatus.in_progress).count()}, "
          f"completed={db.query(Task).filter(Task.status == TaskStatus.completed).count()}, "
          f"disputed={db.query(Task).filter(Task.status == TaskStatus.disputed).count()})")
    print(f"Отклики: {db.query(Response).count()}")
    print(f"Сообщения: {db.query(Message).count()}")
    print(f"Отзывы: {db.query(Review).count()}")
    print(f"Транзакции: {db.query(Transaction).count()}")
    print(f"Уведомления: {db.query(Notification).count()}")
    print(f"Заявки на вывод: {db.query(WithdrawalRequest).count()} "
          f"(pending={db.query(WithdrawalRequest).filter(WithdrawalRequest.status == WithdrawalStatus.pending).count()})")
    print("\nАккаунты для входа:")
    for u in users.values():
        tag = "PRO " if u.is_pro else ""
        print(f"  {u.email:20s} {('Заказчик' if u.role == UserRole.customer else 'Специалист ' + tag):24s} {u.name}")
    db.close()


if __name__ == "__main__":
    main()
