# ДЕЛО

[![CI](https://github.com/topleki57tuu-glitch/delo-marketplace/actions/workflows/ci.yml/badge.svg)](https://github.com/topleki57tuu-glitch/delo-marketplace/actions/workflows/ci.yml)

**Сервис поиска специалистов и маркетплейс товаров с безопасной сделкой.**
Заказчик публикует задачу, исполнители откликаются, деньги резервируются и
переходят исполнителю только после приёмки работы. В разделе товаров оплата
тоже идёт через эскроу — до подтверждения получения.

Рабочий сайт: [дело.online](https://xn--d1acsm.online)

## Возможности

**Задачи и специалисты**
- публикация задачи с бюджетом, сроком, адресом и фото; помощник подсказывает категорию по описанию;
- лента задач с фильтрами и картой (Яндекс Карты), каталог специалистов и публичные профили;
- отклики, выбор исполнителя и чат по задаче в реальном времени (WebSocket) с вложениями;
- безопасная сделка: резерв средств, приёмка, отмена и споры с арбитражем, отзывы и рейтинг.

**Товары**
- каталог с поиском и фильтрами по категории, состоянию, городу и цене;
- заказ с доставкой или самовывозом, деньги удерживаются до подтверждения получения.

**Аккаунт и деньги**
- кошелёк: пополнение через ЮMoney или ЮKassa, вывод средств с проверкой модератором;
- PRO-подписка, верификация документов, уведомления, светлая и тёмная тема;
- админ-панель: статистика, пользователи, споры, заявки на вывод и верификацию.

**Telegram-бот** — «Радар заказов»: присылает новые задачи по выбранным
категориям, городу и минимальной цене (`/start`, `/radar`, `/my`, `/stop`).

## Технологии

| Часть | Стек |
| --- | --- |
| Бэкенд | Python, FastAPI, SQLAlchemy, Alembic, Pydantic, JWT + CSRF |
| Данные | PostgreSQL (прод), SQLite (локально), Redis (кэш, лимиты, онлайн-статус) |
| Фоновые задачи | Celery: письма, уборка токенов и файлов, окончание PRO |
| Фронтенд | React, Vite, Tailwind CSS, Zustand, React Router |
| Бот | aiogram |
| Инфраструктура | Docker Compose, Caddy (HTTPS), Sentry, GitHub Actions |

## Быстрый старт (локально)

Нужны Python 3.13 и Node.js 22.12+ — те же версии, что в CI и Docker-образах.

```bash
git clone https://github.com/topleki57tuu-glitch/delo-marketplace.git
cd delo-marketplace

# Бэкенд
cd backend
pip install -r requirements.txt
cp .env.example .env   # в .env обязательно: ENV=development и ADMIN_EMAILS=admin@delo.ru
python seed_demo.py    # база с демо-данными
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Фронтенд — в другом терминале
cd frontend
npm install
npm run dev
```

Без `ENV=development` приложение считает себя боевым (fail-closed в
`backend/app/core/config.py`) и не стартует без `SECRET_KEY`. Значения из
`.env` не переопределяют уже заданные переменные окружения. Все переменные с
пояснениями — в `backend/.env.example`.

На Windows то же самое делает `start.bat`, остановка — `stop.bat`
(подробнее — [docs/BAT_FILES_GUIDE.md](docs/BAT_FILES_GUIDE.md)).

После запуска:
- сайт — http://localhost:3000
- API — http://localhost:8000, документация Swagger — http://localhost:8000/docs

### Демо-аккаунты

У заказчиков и специалистов пароль общий: `seed_demo.py` берёт его из
`DEMO_PASSWORD`, а если переменная не задана — генерирует случайный. У
модератора пароль отдельный — из `ADMIN_PASSWORD` или тоже сгенерированный.
Оба сохраняются в `backend/demo_password.txt` (файл в `.gitignore`).

- **Заказчики:** anna@delo.ru, dmitry@delo.ru, olga@delo.ru
- **Специалисты:** igor@delo.ru, maria@delo.ru, alexey@delo.ru, elena@delo.ru, sergey@delo.ru
- **Модератор:** admin@delo.ru

Права модератора даёт **только** переменная `ADMIN_EMAILS`, а не роль в базе.
Если адреса там нет, вход пройдёт, но админ-панель ответит 403. С сайта адреса
из `ADMIN_EMAILS` не регистрируются: аккаунт модератора заводится на сервере
командой `bash scripts/admin_access.sh`, локально —
`python create_admin.py you@mail.ru` из каталога `backend`.

## Тесты

Полный набор проверок описан в [.github/workflows/ci.yml](.github/workflows/ci.yml)
и запускается на каждый push и pull request.

```bash
# Фронтенд: юнит-тесты, сборка, проверка CSS-классов
cd frontend
npx vitest run
npx vite build
npm run check:css

# Бэкенд: поднять сервер с демо-данными (см. «Быстрый старт»), затем из корня
python tests/test_auth_flow.py
python tests/e2e_api_test.py
# Самодостаточные наборы поднимают приложение сами, на временной SQLite
python tests/repro_payment_cycle.py
```

Для бэкенд-наборов нужны `pip install -r backend/requirements-dev.txt` и
переменные `ENV=development`, `DEMO_PASSWORD`, `ADMIN_EMAILS` — те же, что в CI.

## Развёртывание

Прод работает на VPS в Docker Compose (`docker-compose.prod.yml`) за Caddy,
который сам выпускает HTTPS-сертификат.

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — первая установка на сервер
- [docs/UPDATE_GUIDE.md](docs/UPDATE_GUIDE.md) — обновление, откат, резервные копии, мониторинг
- [docs/DOMAIN_SETUP.md](docs/DOMAIN_SETUP.md) — домен и HTTPS
- [docs/YOOMONEY_CONNECT.md](docs/YOOMONEY_CONNECT.md) — подключение приёма платежей ЮMoney по шагам

Обновление с Windows — `deploy.bat`, откат — `rollback.bat`.

## Структура

```
backend/     FastAPI: app/api (роутеры), app/core (настройки, безопасность), миграции Alembic
frontend/    React + Vite: src/pages, src/components, src/store (Zustand)
bot/         Telegram-бот
deploy/      конфигурация Caddy
scripts/     развёртывание, обновление, бэкапы, мониторинг
tests/       e2e- и регресс-наборы для бэкенда
docs/        документация; docs/archive — отчёты прошлых этапов
```

## Документация

- Для пользователей: [покупателям](docs/BUYER_GUIDE.md), [продавцам](docs/SELLER_GUIDE.md),
  [руководство пользователя (PDF)](docs/ДЕЛО_Руководство_пользователя.pdf)
- Для разработчиков: [FAQ](docs/FAQ.md), [участие в разработке](docs/CONTRIBUTING.md),
  [архитектура](docs/ARCHITECTURE_DIAGRAM.md), [состояния задачи](docs/TASK_STATES_DIAGRAM.md),
  [Celery и Redis](docs/CELERY_REDIS_SETUP.md), [аудит безопасности, ноябрь 2026](docs/SECURITY_AUDIT_2026-11.md)
