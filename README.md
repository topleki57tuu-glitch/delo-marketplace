# Платформа «ДЕЛО» — маркетплейс специалистов и заказчиков

## Обзор проекта

- **Название**: ДЕЛО (DELO)
- **Цель**: маркетплейс, где заказчики публикуют задания, а специалисты откликаются, работают через чат и безопасную сделку (эскроу), получают оплату и отзывы
- **Стек**: FastAPI (Python) + React (Vite) + SQLAlchemy + SQLite (dev) / PostgreSQL (prod) + WebSocket-чат + Telegram-бот «Радар заказов»

## Запуск в песочнице (текущее окружение)

Сервисы уже запущены через PM2:

| Сервис | Адрес | Описание |
|---|---|---|
| Frontend (Vite dev) | `http://localhost:3000` | SPA + прокси `/api` на бэкенд |
| Backend (FastAPI) | `http://localhost:8000` | REST API + WebSocket + Swagger (`/docs`) |

```bash
# перезапуск
pm2 restart backend frontend

# логи
pm2 logs backend --nostream
```

## Локальный запуск (вне песочницы)

```bash
# 1. Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000          # SQLite по умолчанию

# 2. Демо-данные (пароль у всех: demo123)
python3 seed_demo.py

# 3. Frontend
cd ../frontend
npm install
npm run dev                                    # http://localhost:3000

# 4. Telegram-бот (опционально)
cd ../bot
TG_BOT_TOKEN=... API_URL=http://localhost:8000 FRONTEND_URL=http://localhost:3000 python bot.py
```

## Docker / продакшн

```bash
docker compose up --build
# frontend:80 (nginx, проксирует API) | backend:8000 | postgres | redis | bot
```

- `render.yaml` — деплой на Render (backend python + static frontend + postgres)
- `backend/Dockerfile`, `frontend/Dockerfile`, `bot/Dockerfile` — готовые образы
- Переменные окружения: см. `.env.example` (секреты хранить в `.env`, он в `.gitignore`)

## Демо-аккаунты (пароль у всех: `demo123`)

| Email | Роль | Особенности |
|---|---|---|
| anna@delo.ru | Заказчик | баланс 47 000 ₽, 3 активных заказа, история сделок; по заказу «Фотосъёмка каталога» открыт **спор** (арбитраж) |
| dmitry@delo.ru | Заказчик | сделка «в работе» (эскроу 150 000 ₽ заморожен) |
| olga@delo.ru | Заказчик | 3 открытых заказа |
| admin@delo.ru | **Арбитр** | доступ к `/disputes` — рассмотрение споров (email в `ADMIN_EMAILS`) |
| igor@delo.ru | Специалист PRO ★ | рейтинг 5.0, верифицирован, выполнен 1 заказ |
| maria@delo.ru | Специалист | рейтинг 5.0, верифицирована, 15 откликов |
| alexey@delo.ru | Специалист | исполнитель по ремонту кухни (в работе) |
| elena@delo.ru | Специалист | клининг |
| sergey@delo.ru | Специалист PRO ★ | фотосъёмка каталога (в работе) |

Сценарий для демо: войдите как `igor@delo.ru` → «Все задания» → откликнитесь → войдите как `anna@delo.ru` → откройте её заказ → назначьте исполнителя (эскроу) → чат → «Подтвердить выполнение» → выплата + отзыв.

## Архитектура данных

- **Модели** (`backend/app/models/`): User, Task, Response, Message, Review, Notification, Transaction, PaymentRecord, PasswordResetToken, StoredFile
- **Хранилище**: SQLite (dev, `backend/marketplace_v3.db`, генерируется сидером) / PostgreSQL (prod через `DATABASE_URL`); картинки — в БД (`stored_files`, отдаются через `/files/{id}`)
- **Состояния заказа**: `open` → `in_progress` (назначен исполнитель, бюджет в эскроу) → `completed` (выплата исполнителю + взаимные отзывы); из `in_progress` возможны `disputed` (открыт спор — средства заморожены до решения арбитра) и `cancelled` (отмена — эскроу возвращён заказчику)
- **Арбитраж**: любая сторона сделки может открыть спор; арбитры (email в `ADMIN_EMAILS`) видят споры на `/disputes` и выносят решение — возврат заказчику или выплата исполнителю (с той же комиссией сервиса 5%, для PRO — 0%); инициатор спора может его отозвать с отменой заказа
- **Монетизация**: пакеты откликов (`resp_10/50`) и подписка PRO (`pro_1/3/12`) — PRO даёт безлимит откликов и приоритет в списке откликов; оплата через ЮKassa (`payments.py`, опционально) или демо-пополнение

## API (основное)

| Метод и путь | Описание |
|---|---|
| `POST /register/`, `POST /login` | регистрация / вход (JWT, 7 дней) |
| `POST /auth/forgot-password`, `/auth/reset-password` | сброс пароля (нужен SMTP) |
| `GET/PUT /users/me` | мой профиль (рейтинг, баланс, PRO) |
| `POST /users/me/switch-role` | переключить роль заказчик ⇄ специалист |
| `GET /users/{id}/public`, `GET /users/{id}/reviews` | публичный профиль, отзывы |
| `GET/POST /tasks/` | лента заказов (фильтры: category, search, city, is_remote) / создание (только заказчик); опциональная пагинация `?page=1&per_page=20` → `{tasks, page, per_page, total, pages}`, без `page` — полный список |
| `GET /tasks/{id}` | карточка заказа |
| `POST /tasks/{id}/responses` | отклик (списание 1 кредита, PRO — безлимит) |
| `GET /tasks/{id}/responses` | список откликов (PRO сверху) |
| `PUT /tasks/{id}/assign?specialist_id=` | назначить исполнителя (эскроу-холд бюджета) |
| `PUT /tasks/{id}/complete` | завершить + выплата эскроу исполнителю (повтор → 400; при споре → 400) |
| `POST /tasks/{id}/dispute`, `GET /tasks/{id}/dispute` | открыть спор / статус спора (участники и арбитры) |
| `POST /tasks/{id}/cancel` | отмена заказа с возвратом эскроу заказчику; при открытом споре — только инициатором (спор отзывается) |
| `GET /admin/disputes`, `POST /admin/disputes/{id}/resolve` | арбитраж: список открытых споров / решение (`refund_customer` \| `pay_specialist`) — только `ADMIN_EMAILS` |
| `GET /specialists/` | каталог специалистов: `search`, `city`, `sort` (rating/completed/reviews/newest), `page`, `per_page` |
| `GET /wallet/transactions`, `GET /wallet/transactions.csv` | история операций / выгрузка в CSV (UTF-8 BOM, Excel) |
| `POST /tasks/{id}/review` | отзыв после завершения (взаимный, 1 на заказ) |
| `GET/POST /tasks/{id}/messages`, `WS /ws/tasks/{id}` | чат сделки (REST + realtime) |
| `GET /notifications/`, `POST /notifications/read-all` | уведомления |
| `POST /wallet/deposit` | демо-пополнение (до 100 000 ₽, только dev) |
| `GET /monetization/packages`, `POST /monetization/buy` | пакеты и покупка |
| `POST /upload/image`, `GET /files/{id}` | загрузка/выдача картинок (magic-bytes валидация) |
| `POST /ai/task-helper` | ИИ-помощник оформления заказа (без внешних API) |

## Тесты

```bash
python3 tests/e2e_api_test.py           # 47 проверок: полный цикл сделки, эскроу с комиссией 5%, PRO, WS
python3 tests/e2e_new_features_test.py  # 38 проверок: споры/арбитраж, возврат эскроу, каталог, CSV, сброс пароля
```

Покрывает: регистрацию/вход, роли (проверяются по БД, а не по JWT), создание заказа, отклик и кредиты, эскроу (холд, выплата с удержанием комиссии платформы, **возврат при отмене и арбитраже**), чат (REST + WebSocket broadcast), уведомления, отзывы, монетизацию, защиту от двойной выплаты, споры и решения арбитра, каталог специалистов (поиск/сортировка/пагинация), CSV-экспорт, сброс пароля.

## Безопасность (требования к production)

- `SECRET_KEY` — обязателен, без него backend в `ENV=production` не стартует
- `CORS_ORIGINS` — явный список источников (wildcard отключён); при отсутствии берётся `FRONTEND_URL`
- арбитры/модераторы — строгое совпадение email из `ADMIN_EMAILS` (без substring-проверок)
- rate limiter доверяет `X-Forwarded-For` только от приватных адресов (своего прокси)

## Структура репозитория

```
backend/          FastAPI-приложение (app/api, app/core, app/models, app/schemas)
  seed_demo.py    демо-данные (очищает dev-базу и наполняет её заново)
bot/              Telegram-бот «Радар заказов» (подписки, фильтры, уведомления)
frontend/         React SPA (страницы: лента, заказ, чаты, профиль, создание заказа)
docs/             Руководство пользователя (PDF/HTML + скриншоты)
tests/            E2E-тест API
scripts/          вспомогательные verify/screenshot-скрипты песочницы
docker-compose.yml, render.yaml, Dockerfile×3, Procfile×3
```

## Статус и планы

- **Backend API**: готов (полный цикл сделки с эскроу протестирован E2E)
- **Frontend**: готов (все страницы, тёмная тема, мобильная навигация, WS-чат)
- **Деплой**: конфиги Docker/Render готовы; продакшн-инстанс не поднят из песочницы (требует хостинга с WebSocket: Railway/Render/Fly)
- **Реализовано в этом спринте**:
  - **Безопасность и доверие**: система верификации специалистов (модель `VerificationRequest`, подача заявки через модальное окно паспорта/ИНН самозанятого, рассмотрение модератором `admin@delo.ru`, отображение зелёного бейджа `✓ Проверен` в анкетах, каталоге и карточках).
  - **Монетизация платформы**: эскроу-комиссия 5% сервиса при успешной выплате исполнителю (0% льготная комиссия для специалистов с подпиской PRO); витрина подписок PRO и пакетов платных откликов; прозрачный расчет удержаний в истории транзакций и выгрузке CSV.
  - **Города и география**: расширение базы городов до 250+ населенных пунктов России с возможностью ручного ввода любого посёлка или деревни РФ.
  - **Чат и коммуникация**: чипы быстрых шаблонов ответов в один клик и быстрый переход в карточку сделки.
  - **Арбитраж и эскроу**: открытие споров, арбитраж с возвратом средств заказчику или выплатой исполнителю.
- **Не реализовано / следующие шаги**:
  - боевой SMTP для писем сброса пароля (код есть, нужны переменные `SMTP_*`)
  - боевые ключи ЮKassa (`YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY`, см. `.env.example`; тестовая карта 5555 5555 5555 4444)
  - вебхуки ЮKassa (сейчас подтверждение через `/payments/confirm`)
  - файлы-вложения к спорам и статусная модель арбитража с апелляцией
  - Alembic-миграции вместо самописных `ALTER TABLE` в `main.py`

*Последнее обновление: 2026-09-11*
