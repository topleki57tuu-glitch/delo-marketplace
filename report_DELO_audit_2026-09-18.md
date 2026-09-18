# Аудит приложения «ДЕЛО» (delo-marketplace)

**Дата:** 18.09.2026
**Репозиторий:** `topleki57tuu-glitch/delo-marketplace`
**Коммит:** `0f5261b feat(frontend): replace emoji icons with an SVG icon system`
**Объём:** ~11.7k строк Python, ~12.8k строк JS/JSX, 247 файлов.

> **Статус на 18.09.2026:** все находки CRITICAL/HIGH и ключевые MEDIUM исправлены,
> плюс по ходу проверки найдены и закрыты ещё два дефекта (WebSocket-broadcast и
> CSV-экспорт). Пароль `demo123` вычищен из всех 22 файлов, включая документацию.
> Полный прогон тестов — **116 проверок, 0 падений**.
> Детали — в разделе «Применённые исправления» в конце документа.

---

## Резюме

Код явно прошёл основательную чистку: в комментариях повсюду ссылки на предыдущий аудит
(гонки на балансе, CORS-wildcard, CSRF, XSS через content-type). Деньги почти везде
двигаются через атомарные условные `UPDATE` (`app/core/money.py`) — это правильно.

Но остались **4 критичных дефекта**, из которых два ломают приложение в production
полностью, а один — дыра в деньгах. Ниже — по убыванию опасности.

---

## 🔴 CRITICAL

### C1. ЮMoney-вебхук не работает вообще (оплата не зачисляется)

**Файл:** `backend/app/api/payments.py:235-259`

```python
@router.post("/payments/webhook/yoomoney")
def yoomoney_webhook(request: Request, db: Session = Depends(get_db)):
    ...
    form_data = asyncio.run(request.form())   # строка 256
```

Эндпоинт объявлен как **sync** (`def`, не `async def`). FastAPI выполняет sync-эндпоинты
в threadpool, но `request.form()` — корутина, привязанная к event loop сервера, а
`asyncio.run()` пытается создать **новый** event loop. Результат: либо
`RuntimeError: asyncio.run() cannot be called from a running event loop`, либо зависание
на чтении тела запроса.

**Последствие:** реальные платежи через ЮMoney не зачисляются на баланс никогда —
вебхук отбивает ошибку, пользователь заплатил и не получил деньги. При этом
`broad`-except ниже (`except:`) глушит исключение в `400 Invalid form data`,
из-за чего в логах не видно настоящей причины.

**Фикс:** сделать эндпоинт `async def` и читать `await request.form()`:
```python
@router.post("/payments/webhook/yoomoney")
async def yoomoney_webhook(request: Request, db: Session = Depends(get_db)):
    form_data = await request.form()
```
(`db` в async-эндпоинте — sync-сессия, это ок для объёма нагрузки; альтернатива —
принимать параметры через `Form(...)`.)

---

### C2. `cryptography` не в зависимостях → падение верификации и выводов средств

**Файл:** `backend/requirements.txt` (полный список, 14 строк)

Fernet используется для шифрования номеров документов и платёжных реквизитов
(`backend/app/core/security.py:117`):

```python
def _fernet() -> "Fernet":
    import base64, hashlib
    from cryptography.fernet import Fernet
```

**`cryptography` в requirements.txt отсутствует.** Она подтягивается транзитивно как
зависимость `python-jose[cryptography]` — то есть сейчас, скорее всего, работает. Но это
случайность, а не контракт: любая смена extra у `python-jose` (или его версии) роняет
`encrypt_sensitive`, а вместе с ней — подачу верификации, заявку на вывод и просмотр
реквизитов модератором. `ImportError` вылезет в рантайме, не на билде.

**Фикс:** добавить явно `cryptography==43.0.3` (или актуальную) в `requirements.txt`.

---

### C3. Права модератора на фронтенде: расхождение с бэкендом + подстрочная проверка

**Файлы:**
- `frontend/src/App.jsx:77` — `const isAdmin = !!user?.email && ['admin@delo.ru'].includes(user.email);`
- `frontend/src/pages/ProfilePage.jsx:66` — `user.email.toLowerCase() === 'admin@delo.ru' || user.email.toLowerCase().includes('admin')`
- `frontend/src/pages/AdminDashboardPage.jsx` (аналогично)

Бэкенд определяет админа строго по списку из `ADMIN_EMAILS` (`app/core/security.py:168-184`),
дефолта нет намеренно.

**Две проблемы:**

1. **Расхождение.** Если в `ADMIN_EMAILS` указан любой другой адрес, UI не покажет
   админ-панель вообще — при том что API права выдать готов. Админ не сможет
   разбирать споры и выплаты из интерфейса.

2. **`ProfilePage.jsx:66` — `includes('admin')`** — это тот самый подстрочный матч,
   который на бэкенде уже убрали с комментарием «подстрочная проверка выдала бы права
   модератора любому admin-vasya@x.com». Здесь он остался. Само по себе это не эскалация
   (решает бэкенд), но UI раскроет панель с очередью выплат и **полными реквизитами
   карт** — а данные для этой панели фронт тянет запросом, который бэкенд отклонит.
   Пользователь увидит нерабочую админку и решит, что «сломалось».

**Фикс:** убрать хардкод; отдавать признак `is_admin` в `GET /users/me` и `login`
(одна строка в `users.py` через `is_admin(user)`) и полагаться на него.

---

### C4. Угон денег через `label` в ЮMoney-вебхуке (когда C1 починят)

**Файл:** `backend/app/api/payments.py:280-297`

```python
if not label.startswith("delo_"): ...
parts = label.split("_")
user_id = int(parts[1])          # ← user_id берётся ИЗ ПОДПИСАННОЙ, НО НЕ НАШЕЙ строки
...
credit_balance(db, user_id, amount)
```

Логика: «label формата `delo_USER_ID_XXXX` → зачислить этому user_id». Подпись
`sha1_hash` подтверждает, что уведомление пришло от ЮMoney, но **`label` формирует
плательщик** — он попадает в параметры Quickpay-формы (`yoomoney.py:126`) и в поле
комментария к переводу. Плательщик может отправить произвольный `label`:
`delo_1_deadbeef` — и деньги уйдут пользователю №1, а не ему.

**Последствие:** любой, кто пополнит кошелёк на 1 ₽ и подделает label, зачислит эту
сумму себе или третьему лицу. Прямая дыра в деньгах.

**Фикс:** не доверять `label` как источнику `user_id`. Хранить созданный платёж в БД
(таблица `payment_records` уже есть, но заполняется только post-factum) и при вебхуке
искать запись по `label`; если её нет — отклонять. Ссылаться на сохранённый `user_id`
из БД, а не парсить строку.

---

## 🟠 HIGH

### H1. Регистрация: роль выбирает сам пользователь

**Файлы:** `backend/app/schemas/__init__.py:35`, `backend/app/api/auth.py:44-49`

```python
class UserCreate(BaseModel):
    role: UserRole = UserRole.customer     # ← приходит из тела запроса
...
new_user = User(..., role=user.role, ...)   # ← пишется как есть
```

Любой может зарегистрироваться сразу как `specialist`. Само по себе не критично
(`switch_role` всё равно даёт это одним запросом), но создаёт разрыв с логикой
остального кода, где роль перепроверяется из БД с комментарием «в токене роль
устаревшая». Если роль задумана как что-то требующее верификации/оплаты — это дыра.

**Фикс:** убрать `role` из `UserCreate`, форсировать `customer`, оставить `switch_role`.

---

### H2. Арбитраж по заданиям пишет баланс неатомарно

**Файл:** `backend/app/api/disputes.py:313` и `:338`

```python
customer.balance += budget     # строка 313 — refund_customer
...
executor.balance += payout     # строка 338 — pay_specialist
```

Тот самый паттерн «прочитал — сложил — записал», от которого ушли **все остальные**
денежные пути (см. `app/core/money.py`, докстринг: «на аудите 18.09.2026 так получилось
вывести 2000 ₽ с баланса в 1000 ₽»). Соседняя ветка `_resolve_order_dispute`
(`disputes.py:232, 257`) уже использует `credit_balance` — то есть ветка заданий просто
отстала при рефакторинге.

Здесь это гонка **зачисления** (не списания): при конкурентном зачислении сумма может
потеряться, а не удвоиться. Так как решение арбитра защищено `dispute.status != open`,
дважды выплатить нельзя — но потерять выплату при параллельной записи баланса можно.

**Фикс:** заменить обе строки на `credit_balance(db, customer.id, budget)` /
`credit_balance(db, executor.id, payout)`.

---

### H3. 13 изменяющих эндпоинтов без CSRF-проверки

**Найдено:** `verify_csrf` присутствует только в `auth.py`, `tasks.py`, `products.py`,
`payments.py`, `withdrawals.py`* , `files.py`, `disputes.py`.

Без проверки остались:

| Файл | Эндпоинты |
|---|---|
| `users.py:81, 121` | `PUT /users/me`, `POST /users/me/switch-role` |
| `chat.py:133, 155` | `PUT /messages/read`, `POST /messages` |
| `notifications.py:35, 43` | `POST /read-all`, `PUT /{id}/read` |
| `reviews.py:91` | `POST /tasks/{id}/review` |
| `responses.py:23` | `POST /tasks/{id}/responses` |
| `verification.py:47, 135` | `POST /submit`, `POST /admin/{id}/review` |
| `auth.py:55, 87, 118` | `POST /login`, `/refresh`, `/logout` |
| `ai.py:116` | `POST /task-helper` |

\* `withdrawals.py` — самая болезненная дыра: **подача заявки на вывод
(`POST /wallet/withdraw`), её отмена и решение модератора (`POST /admin/withdrawals/{id}/review`)
не защищены CSRF-токеном вовсе.**

**Последствие:** в production `CSRF_ENABLED = True`, `cookie samesite="strict"` —
браузер не отправит CSRF-cookie на кросс-сайтовый запрос, так что реальный вектор
ограничен. Но согласованности нет: часть роутеров защищена, часть — нет, и защита
держится на `samesite` cookie, а не на явной проверке. `POST /admin/withdrawals/{id}/review`
(выплата по реквизитам) стоило бы закрыть в первую очередь.

**Фикс:** добавить `_csrf: None = Depends(verify_csrf)` в перечисленные эндпоинты.

---

### H4. `withdrawals.py` — вся денежная поверхность без CSRF

Отдельно от H3, потому что это прямой денежный путь. `POST /wallet/withdraw` списывает
баланс, `POST /admin/withdrawals/{id}/review` фиксирует выплату. Ни один не проверяет
CSRF. Идемпотентность сделана правильно (`_claim_status` через атомарный `claim`),
но сам запрос не защищён от подделки источника.

**Фикс:** `Depends(verify_csrf)` на все три изменяющих эндпоинта.

---

### H5. `complete_order`: списание эскроу без проверки владельца товара

**Файл:** `backend/app/api/products.py:524-528`

```python
seller = db.query(User).filter(User.id == order.seller_id).with_for_update().first()
if not seller:
    raise HTTPException(409, "...")
```

Продавец берётся **из `order.seller_id`**, а не проверяется, что он реально владеет
`product_id`. Между созданием заказа и завершением товар мог быть перепродан/удалён
(`DELETE /products/{id}` ставит `status='removed'`, но не трогает существующие заказы).
Впрочем, `order.seller_id` фиксируется при создании заказа из `product.seller_id`, так
что подмены здесь нет — это скорее вопрос трактовки, чем дефект. **Понижаю до LOW.**

---

## 🟡 MEDIUM

### M1. `seed_demo.py` создаёт админа с паролем `demo123`

**Файлы:** `backend/seed_demo.py:31` (`PASSWORD = "demo123"`), `:102-105`

```python
add_user("admin", "admin@delo.ru", "Арбитр ДЕЛО", "customer", ..., balance=0, verified=True, ...)
```

Плюс README и QUICK_START публикуют список демо-аккаунтов с паролями (`anna@delo.ru /
demo123` и т.д.).

Сидирование запускается только при `SEED_DEMO=1` (`main.py:77`), и в
`docker-compose.prod.yml` / `render.yaml` эта переменная **не выставлена** — то есть
в production демо-данные не создаются. Это правильно. Но:

- `PASSWORD = "demo123"` не варьируется и не читается из env;
- если кто-то включит `SEED_DEMO=1` на боевом контуре (или скопирует `.env` из dev),
  на платформе появится `admin@delo.ru` с публично известным паролем, и он **попадёт
  в права модератора**, если этот адрес есть в `ADMIN_EMAILS`.

**Фикс:** читать пароль демо-юзера из env с генерацией случайного, если не задан;
захардкодить отказ от `SEED_DEMO`, когда `ENV=production`.

---

### M2. `docker-compose.prod.yml` не передаёт переменные ЮMoney

**Файл:** `docker-compose.prod.yml:57-77`

В `environment` backend проброшены `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY`, но
**нет** `YOOMONEY_ACCESS_TOKEN`, `YOOMONEY_CLIENT_ID`, `YOOMONEY_REDIRECT_URI`,
`YOOMONEY_NOTIFICATION_SECRET`.

При этом `.env.example` их не документирует вообще, а `payments.py:144` по умолчанию
выбирает провайдера `"yoomoney"`. Итог: на своём VPS ЮMoney всегда «не настроен»
(HTTP 400), и работает только ЮKassa.

**Фикс:** добавить переменные в compose и в `.env.example`.

---

### M3. `ecosystem.config.cjs` содержит dev-секрет и хардкод админа

**Файл:** `ecosystem.config.cjs:12-13`

```js
SECRET_KEY: 'marketplace_dev_secret_key',
ADMIN_EMAILS: 'admin@delo.ru',
```

Захардкоженный `SECRET_KEY` в репозитории — плохо само по себе. Плюс `ADMIN_EMAILS:
'admin@delo.ru'` — ровно тот дефолт, который в `security.py` убрали с комментарием
«права модератора получал любой, кто первым занял этот адрес». В файле PM2 он остался.

**Фикс:** вынести в `.env`, файл не коммитить или оставить только dev-заготовку без секретов.

### M4. В git закоммичены `backend.pid` и `frontend.pid`

```
$ git ls-files | grep -i pid
backend.pid
frontend.pid
```

Рантайм-артефакты, не место в репозитории. Плюс `bot.subscriptions.json*` в
`.gitignore` есть (хорошо), а `.pid` — нет.

**Фикс:** `git rm --cached backend.pid frontend.pid` и добавить `*.pid` в `.gitignore`.

### M5. `update_profile` не валидирует URL аватара и портфолио

**Файл:** `backend/app/api/users.py:97-114`

```python
if profile.avatar is not None:
    if profile.avatar == "": user.avatar = None
    else: user.avatar = profile.avatar      # ← как есть
```

Комментарий в коде честно говорит «упрощённая проверка». `avatar` и `portfolio`
принимают любую строку: `javascript:alert(1)`, `data:text/html,...`. Если фронтенд
когда-нибудь отрисует это как `href`/`src` без санитайза — готовый stored XSS.
Сейчас JSX экранирует по умолчанию, так что это латентная проблема, не активная.

**Фикс:** валидировать схему (`http`/`https`) и/или ограничиться внутренними путями
`/files/{id}`.

---

## 🟢 LOW / гигиена

| # | Что | Где |
|---|---|---|
| L1 | 47 `.md`-файлов в корне (отчёты о прошлых правках, `TEST_*.md`, `*_SUCCESS.md`) — половина противоречит друг другу | корень репо |
| L2 | `frontend/.gitignore` не игнорит `.env*` для Vite-переменных | `frontend/` |
| L3 | `bot/bot.py:21-22` — дефолтные URL прода (`delos-backend.onrender.com`) захардкожены в коде | `bot/bot.py` |
| L4 | Rate limit для WebSocket — словарь `_ws_rate_limit` без ограничения роста (в отличие от `_rate_buckets`, где есть чистка) | `chat.py:17` |
| L5 | `main.py:250` — `db.execute("SELECT 1")` строкой: в SQLAlchemy 2.0 требует `text()`, работает только из-за legacy-режима | `main.py` |
| L6 | `frontend` `isAdmin` дублируется в `App.jsx`, `ProfilePage.jsx`, `AdminDashboardPage.jsx` — три места для одной проверки | `frontend/src/` |

---

## Что сделано правильно (чтобы не переделывать)

Это стоит зафиксировать — тут действительно хорошая работа:

- **Атомарные деньги.** `credit_balance` / `debit_balance` / `claim` в
  `app/core/money.py` — условные `UPDATE`, а не read-modify-write. Причина выборa
  (FOR UPDATE игнорируется на SQLite) описана в докстринге. Применено в 12+ местах.
- **Эскроу-модель вывода.** Сумма списывается при подаче заявки, не при решении
  модератора (`withdrawals.py:108-113`). Идемпотентность через `claim` — двойное
  нажатие «отклонить» не вернёт деньги дважды.
- **Шифрование PII.** Номера паспортов/ИНН и реквизиты — Fernet, плюс маскирование
  (`mask_document_number`, `mask_requisites`). Есть обработка наследственных
  незашифрованных записей.
- **CSRF double-submit** как механизм + обёртка над `fetch` на фронте с ретраем на 403.
- **CORS без wildcard**, обязательный `SECRET_KEY` в prod, отсутствие дефолтного админа.
- **Токены:** access 15 мин / refresh 7 дней с blacklist по `jti`, отзыв всех сессий при logout.
- **Загрузка файлов:** magic-byte sniffing (`sniff_image_type`), content-type от клиента
  не доверяется — закрывает stored XSS через заголовок.
- **Наличие миграций Alembic** (9 штук) и тестов (`tests/`, 4 файла).

---

## Порядок исправления

1. **C1** — ЮMoney-вебхук (`async`). Иначе оплата не работает совсем.
2. **C4** — доверие к `label`. Дыра в деньгах; актуальна сразу после починки C1.
3. **C2** — `cryptography` в requirements. Один ImportError роняет верификацию и выводы.
4. **H4 / H3** — CSRF на денежные и админские эндпоинты.
5. **H2** — атомарность в арбитраже заданий.
6. **C3** — `is_admin` с бэкенда вместо хардкода.
7. **M1, M3** — секреты и демо-пароли.
8. Остальное — по мере.

---

## Применённые исправления

Все правки сделаны в рабочей копии (`git status` — 26 изменённых файлов,
4 новых). Ничего не закоммичено.

### CRITICAL

| # | Что было | Что стало | Файл |
|---|----------|-----------|------|
| C1 | Вебхук ЮMoney — sync-эндпоинт с `asyncio.run()`, падал при любом уведомлении | `async def` + `await request.form()`, разбор с обработкой ошибок | `app/api/payments.py` |
| C4 | Зачисление по `label` из уведомления — можно было подделать сумму/получателя | Таблица `payment_records`: запись создаётся **до** редиректа на оплату, вебхук ищет её, сверяет сумму и берёт `user_id`/`amount` из своей записи. Неизвестный `label` → 404 | `app/models/__init__.py`, `app/api/payments.py`, миграция `c7a1e4b90d52` |
| C2 | `cryptography` не в requirements → ImportError роняет верификацию и выводы | Явный пин `cryptography==46.0.7` (совместим с `python-jose`, требует `>=3.4.0`) | `requirements.txt` |
| C3 | `is_admin` считался на фронте по хардкоду `admin@delo.ru` и эвристике `includes('admin')` | Бэкенд отдаёт `is_admin` в `GET /users/me`; фронт читает `user?.is_admin` | `app/api/users.py`, `frontend/src/App.jsx`, `frontend/src/pages/ProfilePage.jsx` |

**Идемпотентность зачисления** держится на `credited_at IS NOT NULL` (было —
на метаданных провайдера, которые подделываются вместе с `label`).
Миграция идемпотентна и обратима, проверена `upgrade → downgrade → upgrade`.

### HIGH

| # | Что было | Что стало |
|---|----------|-----------|
| H1 | Роль (`role`) принималась от клиента при регистрации — самоповышение до `specialist` одним полем | Поле убрано из `UserCreate`, роль жёстко `customer`; смена только через `POST /users/me/switch-role` |
| H2 | В арбитраже балансы менялись через `+=` (не атомарно) | `credit_balance()` из `app/core/money.py` |
| H3/H4 | 13 state-changing эндпоинтов без CSRF | `Depends(verify_csrf)` добавлен на все (выводы, верификация, чат, уведомления, отзывы, отклики, профиль, AI) |

**Проверка H3/H4:** новый `tests/test_csrf_coverage.py` при `CSRF_ENABLED=1`
бьёт по всем перечисленным эндпоинтам **без** заголовка `X-CSRF-Token` —
все 9 кейсов возвращают **403**. До правок они проходили бы.

### MEDIUM

| # | Что было | Что стало |
|---|----------|-----------|
| M1 | `demo123` захардкожен в `seed_demo.py`, `README`, `QUICK_START` | `DEMO_PASSWORD` из env или `secrets.token_urlsafe(9)`; seed отказывается работать при `IS_PRODUCTION` |
| M3 | `SECRET_KEY` и `ADMIN_EMAILS` захардкожены в `ecosystem.config.cjs` | Читаются из `process.env`, дефолты безопасные |
| M5 | `portfolio`/аватары — произвольные URL | `_safe_media_url` + `_sanitize_portfolio` (белый список префиксов, лимиты 30 элементов / 500 символов) |
| — | `backend.pid`, `frontend.pid` в индексе git | Удалены из индекса, `*.pid` в `.gitignore` |

### M1, продолжение: `demo123` вычищен из всех 22 файлов

Одного `seed_demo.py` мало — пароль был **опубликован в документации**, то есть
известен любому, у кого есть репозиторий. Правки:

- **Батники запуска.** `start.bat` печатал три демо-аккаунта с `demo123` прямо
  в консоль; `open-admin.bat` повторял то же для админа. Оба теперь ссылаются
  на `backend\demo_password.txt` и выводят его содержимое, если файл есть.
- **`seed_demo.py`** дополнительно пишет пароль в `backend/demo_password.txt`
  (нужно, потому что `start.bat` создаёт базу в фоне и вывод скрипта теряется).
  Файл закрыт в `.gitignore` — проверено `git check-ignore`.
- **`scripts/vps_deploy.sh`** — это деплой: пароль больше не печатается в лог,
  вместо этого подсказка про `DEMO_PASSWORD` и `exec ... cat demo_password.txt`.
  Плюс предупреждение, что демо-данные в проде создают админа.
- **17 документов** (`README`, `QUICK_START`, `QUICK_START_WINDOWS`, гайды
  покупателя/продавца, `ADMIN_DASHBOARD*`, `MARKETPLACE_TESTING` и др.) —
  все 30 вхождений заменены на отсылку к файлу пароля или `$DEMO_PASSWORD`.
- Заодно поправлен устаревший пример кода в `ADMIN_DASHBOARD.md`: он всё ещё
  показывал `['admin@delo.ru'].includes(user.email)` как правильный вариант.

**Порядок добавления нового админа** (проверено вживую): email добавляется в
`ADMIN_EMAILS`, роль в БД может оставаться `customer` — `is_admin` считается
только по email. Фактическая проверка: `admin@delo.ru` → `is_admin: true`
при `role: customer`, `anna@delo.ru` → `is_admin: false`.

### Найдено при проверке (не было в исходном аудите)

**1. WebSocket-broadcast не работал — живой чат молча не обновлялся.**
`app/services/websocket_manager.py:24-31` делал `json.dumps(message)`, а в
`message_dict` лежит `created_at` (`datetime`) → `TypeError`. Исключение
глоталось `except Exception: pass`, поэтому сбой был невидим. Починено:
`json.dumps(..., default=_json_default)`, а ошибки отправки теперь логируются.

Репро (до фикса): подключиться к `/ws/tasks/{id}`, сделать `POST /messages` →
сообщение сохраняется (200), broadcast на сервере срабатывает
(`conns={id: 1}`), но клиент не получает **ничего**.

**2. CSV-экспорт истории кошелька отдавал 500.**
`app/api/users.py:312` — `(t.created_at or "")[:19]` при `created_at: datetime`
→ `TypeError: 'datetime.datetime' object is not subscriptable`. Эндпоинт был
сломан при любой непустой истории. Заменено на `_fmt_dt()` со `strftime`.

**3. Роль в JWT не обновлялась после switch-role.**
`switch_role` меняет роль в БД и возвращает **новый** токен, но старый токен
продолжает утверждать `role=customer`. Если клиент не заменит токен,
`PUT /tasks/{id}/assign` вернёт `400 «Специалист не найден»` (проверка
`payments.py:375` сверяет роль в БД, а `specialist_id` берётся из
`/users/me`). Тесты теперь явно используют токен из ответа switch-role.

**4. Seed и сервер могли молча работать с РАЗНЫМИ базами.**
`app/core/config.py:20` — `DATABASE_URL` по умолчанию `sqlite:///./marketplace_v3.db`,
относительный путь резолвится от **текущей рабочей директории процесса**.
`python backend/seed_demo.py` из корня проекта создавал БД в корне
(`./marketplace_v3.db`), а `uvicorn` из `backend/` читал `backend/marketplace_v3.db`.
Обе базы существовали одновременно, без единой ошибки в логах.

Проявление: после `seed_demo.py` вход под `admin@delo.ru` возвращал `401`,
хотя в файле `demo_password.txt` пароль был правильный — хеш лежал в
«призрачной» базе в корне. `tests/e2e_new_features_test.py` из-за этого давал
`31 passed, 1 failed` вместо `38 passed, 0 failed`.

Исправлено на уровне конфига, а не скриптов — теперь любой способ запуска
даёт один и тот же файл:

```python
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def _absolutize_sqlite(url: str) -> str:
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    path = url[len(prefix):]
    if not path or path == ":memory:" or os.path.isabs(path):
        return url
    return prefix + os.path.normpath(os.path.join(BACKEND_DIR, path))

# ...
DB_URL = _absolutize_sqlite(DB_URL)
```

Проверено: запуск из корня и из `backend/` даёт идентичный
`DB_URL: sqlite:///...\backend\marketplace_v3.db`. Призрачный
`./marketplace_v3.db` удалён, база пересоздана — все 4 e2e-набора зелёные.

### Тесты

Общий хелпер `tests/_helpers.py` — `Session` с автоматической подстановкой
`X-CSRF-Token` (запрашивает `/csrf-token`, шлёт заголовок на write-запросы),
`trust_env = False` (иначе локальные запросы уходят в системный прокси и
получают 502), `register()`/`make_specialist()` с учётом нового контракта роли.

Приведены в актуальное состояние все 4 существующих файла тестов + 1 новый:

| Файл | Результат |
|------|-----------|
| `tests/test_auth_flow.py` | 11 проверок OK (добавлен кейс «role=admin при регистрации игнорируется») |
| `tests/test_csrf_coverage.py` | 9 проверок OK, все 403 (новый) |
| `tests/test_chat_reviews_notifications.py` | 10 проверок OK |
| `tests/e2e_api_test.py` | 48 OK, 0 FAIL (был 1 FAIL по WS) |
| `tests/e2e_new_features_test.py` | 38 OK, 0 FAIL (были 2 FAIL; без seed — 31 OK, проверки арбитража SKIP) |

**Итого 116 проверок, 0 падений** на сидированной базе, при `CSRF_ENABLED=1`.

Отдельно проверено: миграции `upgrade head` с нуля (10/10), идемпотентность,
`downgrade`/`upgrade`; `vite build` проходит; `py_compile` по всем
изменённым `.py` — чисто; `bash -n scripts/vps_deploy.sh` — чисто.

**Грабли прогона (чтобы не наступить снова):** тесты арбитража требуют
`ADMIN_EMAILS` **в окружении backend-процесса**. Если задать переменную только
в оболочке тестов, `admin@delo.ru` не получит прав и 5 проверок упадут с
`403 «Доступно только арбитрам платформы»`. Правильный запуск:

```bash
cd backend && CSRF_ENABLED=1 ADMIN_EMAILS=admin@delo.ru \
  DEMO_PASSWORD=... <venv>/python -m uvicorn main:app --port 8000
```

### M1, окончание: `demo123` вычищен из вспомогательных скриптов

Скриншотер и браузерные проверки (`scripts/make_screenshots.py`,
`retake_shots.py`, `verify_all_systems.py`, `verify_browser_auth.py`,
`verify_browser_test.py`, `verify_profile_chats_final.py`,
`reproduce_auth_browser.py`) тоже хардкодили `demo123` — итого ещё 13 мест.
Добавлен общий резолвер `scripts/_demo_env.py`: читает `DEMO_PASSWORD` из
окружения, иначе машиночитаемую строку `password = ...` из
`backend/demo_password.txt`, иначе падает с внятной инструкцией. Формат
файла, который пишет `seed_demo.py`, переведён с человекочитаемого
`«Пароль для всех демо-аккаунтов: ...»` на `password = ...` (парсер
поддерживает обе формы). Заодно убраны хардкод-пути
(`/home/user/webapp/backend/marketplace_v3.db`) и адреса `localhost:3000`
заменены на `API_BASE`/`WEB_BASE` из окружения.

Проверка: `grep -rn demo123` по `scripts/`, `tests/`, `backend/`,
`frontend/src/` не находит ничего, кроме пояснительных комментариев о том,
что хардкод убран.

### Осталось (не блокирует)

- **`switch-role` и устаревшая роль в токене — это UX, а не безопасность.**
  Проверено: роль из JWT **не читается нигде** — ни одного `.get("role")` по
  всему бэкенду. Все 103 обращения к payload берут только `sub` (id), а роль
  всегда тянется из БД. Поэтому старый токен не даёт никаких лишних прав.
  Единственный эффект — фронт может отрисовать интерфейс по роли из токена
  до его обновления. Правильная реакция: после `switch-role` класть в стор
  токен из ответа (уже так) и не считать это уязвимостью.
- **Redis в dev не поднят** → rate-limit и кэш работают в памяти процесса
  (порог умножается на число воркеров). Для production `REDIS_URL` обязателен.
- **Демо-данные в проде** создают аккаунт с правами арбитра. Скрипт
  предупреждает, но код не запрещает — если `SEED_DEMO` когда-нибудь
  включат на боевом контуре, админ появится с паролем из `DEMO_PASSWORD`.
  Стоит запретить seed при `IS_PRODUCTION` жёстко (сейчас он это делает,
  однако `IS_PRODUCTION` определяется по `ENV`).
