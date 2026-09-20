# «ДЕЛО» — третья итерация: CI стоял красным, признак «онлайн» был мёртв

Дата: 20.09.2026
База: `topleki57tuu-glitch/delo-marketplace`, коммит `6f1c000` → исправлено и запушено (`a6adfcd`, `e034aa8`)
Проверялось: 19 наборов, живой сервер, собранный фронтенд, API GitHub Actions, чистый venv из объявленных зависимостей

---

## Коротко

Два дефекта, которые не видны при чтении кода и не видны при запуске отдельного набора.

**Первый: CI не работал.** Четыре последних прогона на `main` — `failure`, включая `6f1c000`. Набор `e2e_new_features_test` входил админом под демо-пароль, а у админа с коммита `f48b2bd` пароль отдельный. Падение на пятом наборе из девяти останавливало цикл (`set -e`), и **14 наборов из 18 не запускались вообще** — включая все восемь самодостаточных, регрессы на деньги и удаление данных.

**Второй: признак «онлайн» не вычислялся нигде.** Функция `user_online` лежала в двух копиях, и обе возвращали `False` на каждом вызове: считали aware минус naive и `fromisoformat` по объекту `datetime`, а исключение глоталось `except Exception: return False`. Данные при этом были верные — админка показывала 4 онлайн-человека, пока API отдавал `false` всем.

**Третий: вторая группа наборов не могла запуститься вообще.** Восемь из девяти наборов поднимают приложение через `fastapi.testclient`, которому нужен `httpx`, а `httpx` не объявлен ни в одном файле зависимостей — он просто лежал в рабочей venv. Группа была подключена, но не выполнялась ни разу, потому что её останавливал первый дефект. Как только первый починили, она упала на входе.

Все три исправлены, все закрыты регрессами. Плюс закрыто слепое пятно в проверке документации и найдено несколько вещей, которые решает пользователь, а не я.

---

## Что проверено

Локально, на SQLite (в CI — PostgreSQL; доступа к локальному Postgres нет, пароль не подобран). Сервер поднят с `CSRF_ENABLED=1` в окружении, повторяющем джобу CI буквально.

| Что | Итог |
|---|---|
| Группа 1: 9 наборов против живого сервера | 9/9 |
| Группа 2: 9 самодостаточных наборов | 9/9 |
| Группа 2 в чистом venv из `requirements-dev.txt` | 9/9 (и падение без `httpx` — воспроизведено) |
| Проверка примеров в документации | код 0 |
| Смена пароля админа | 26 проверок, 0 провалов |
| Лимит перебора по аккаунту (`RATE_LIMIT_ENABLED=1`) | 6 проверок, 0 провалов |
| Фронтенд: vitest | 20/20 |
| Фронтенд: `vite build` | собралось |
| Охранник CSS | 8264 класса, 7 известных пропусков |

Отдельно названные числа: `e2e_api_test` 48, `test_csrf_coverage` 15, `test_yoomoney_webhook` 17, `check_file_cleanup` 18, `repro_verification_document_access` 24, `check_online_status` 17 (новый).

---

## Дефекты

### D1. Критический. Вход админом под демо-паролем — CI стоял, 14 наборов не запускались

`tests/e2e_new_features_test.py:195` брал пароль админа так:

```python
admin_pwd = os.environ.get("DEMO_PASSWORD", "")
```

Но `seed_demo.py:61` заводит админу **отдельный** пароль:

```python
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or generate_strong_password()
```

`ADMIN_PASSWORD` не задан ни в `ci.yml`, ни в `docker-compose`, ни в `render.yaml`, ни в bat-файлах — то есть админ всегда получает сгенерированный пароль. Демо-пароль на нём не работает никогда.

Последствия различались по окружению:

- **в CI** (`DEMO_PASSWORD=ci-demo-password`) — вход 401, проверка `Арбитр admin@delo.ru доступен (seed)` падает, `set -e` в цикле `Run test suites` останавливает шаг. Наборы 6–9 группы, все 8 самодостаточных и проверка смены пароля админа не выполняются;
- **локально** (`DEMO_PASSWORD` не задан) — набор печатал `SKIP Арбитр`, пропускал весь блок арбитража и заканчивался зелёным `31 passed, 0 failed`.

Доказательства:

```
цикл CI с set -e, окружение джобы:
  test_auth_flow                         ок
  security/check_refresh_token_whitelist ок
  test_csrf_coverage                     ок
  test_chat_reviews_notifications        ок
  e2e_new_features_test                  УПАЛ (код 1)   ← здесь цикл встаёт
  РЕЗУЛЬТАТ: 31 passed, 1 failed
  (наборы 6–9 группы, 8 самодостаточных и смена пароля админа не запускались)

API GitHub Actions, последние прогоны main:
  6f1c000  failure
  707b782  failure
  839dfe2  failure
  a5fecc4  failure
```

Исправлено в `528dc75`. В `tests/_helpers.py` появился общий резолвер `demo_password()` / `admin_password()`: берёт значение из окружения, иначе из `backend/demo_password.txt` — того же файла, куда его пишет seed. `SKIP` заменён на честный `FAIL` с объяснением: набор, который пропускает половину проверок и отчитывается зелёным, хуже отсутствующего.

**Почему это важно не только как «починили CI».** Второй симптом (тихий SKIP) объясняет, почему прошлая итерация отчиталась «0 ошибок»: набор запускался без `DEMO_PASSWORD`, блок арбитража пропускался, и ноль был получен по неверной причине. Ровно та же ловушка, что и в прошлый раз с пятью незапущенными наборами.

### D2. Высокий. Два набора носили захардкоженный пароль из сессии аудита

```python
# tests/repro_chat_attachment_base64.py:39
# tests/security/repro_files_public_access.py:30
PASSWORD = os.environ.get("DEMO_PASSWORD", "AuditPass_2026x")
```

`AuditPass_2026x` — пароль из прошлой сессии аудита, которого в проекте давно нет. В CI это не всплывало (переменная задана джобой), вне CI оба набора падали на входе с `login failed: 401 Неверный email или пароль` — симптом указывает на авторизацию, а не на ненайденный пароль. При этом в проекте **уже был** правильный резолвер `scripts/_demo_env.py`, которым пользуются семь скриптов; два набора просто не перевели.

Исправлено в том же `528dc75`.

### D3. Высокий. Признак «онлайн» возвращал `false` всегда — в двух копиях

Функция `user_online` существовала в двух местах и в обоих была сломана одинаково — глушением исключения:

```python
# app/api/users.py:83
return (datetime.now(timezone.utc) - last_seen_dt).total_seconds() < 120
#   → TypeError: can't subtract offset-naive and offset-aware datetimes
#     (колонка last_seen объявлена Column(DateTime) без timezone=True)

# app/api/responses.py:15
return (datetime.utcnow() - datetime.fromisoformat(user.last_seen)).total_seconds() < 120
#   → TypeError: fromisoformat: argument must be str
#     (user.last_seen — объект datetime, а не строка)
```

Оба `TypeError` ловились `except Exception: return False`, поэтому снаружи всё выглядело как «пользователи офлайн».

Замер на живом стенде до правки:

```
igor.last_seen      = 2026-09-20 07:07:36.311384 (тип: datetime)
отставание от сейчас: 91.5 сек — внутри окна 120 с
users.user_online     -> False
responses.user_online -> False
эталон (admin.py:64, SQL):  online-пользователей: 4
```

Что это ломало: `online` в `GET /users/me`, `online` в `GET /specialists/`, `specialist_online` в списке откликов и бейдж «Онлайн» в `SpecialistsPage.jsx:137` — он не отрисовывался никогда. При этом `last_seen` честно обновляется middleware `track_last_seen` (`main.py:203`), то есть данные были верные, а признак на них врал.

Исправлено в `d472ae1`:

- `app/core/presence.py` — одна реализация на проект, сравнивает naive UTC с naive UTC (как `admin.py`), принимает `str` (след миграции `b31957f1dbe9`), naive и aware `datetime`, `None`. Исключения не глушит;
- `admin.py` берёт окно из `ONLINE_WINDOW_SECONDS`, а не из литерала `120` — иначе счётчик и бейджи разъедутся;
- `main.py` пишет в `last_seen` naive UTC. Прежде туда уходил aware `datetime.now(timezone.utc)`; значение совпадало с UTC только потому, что смещение нулевое, а замена на `datetime.now()` уехала бы на три часа и держала бы всех «онлайн» ещё три часа после ухода;
- `tests/security/check_online_status.py` — регресс на 17 проверок: сама функция и четыре поверхности, где признак виден снаружи. Добавлен в CI.

Регресс проверен **в обе стороны**:

```
исправленный код:                       passed=17 failed=0  (код 0)
дефект внесён обратно:                  passed=7  failed=14 (код 1)
  FAIL свежий naive datetime -> онлайн | исключение TypeError: can't subtract offset-naive and offset-aware datetimes
  FAIL GET /users/me (свежий): HTTP 200 | пришло 500 Internal Server Error
  FAIL GET /specialists/: HTTP 200 | пришло 500 Internal Server Error
```

### D4. Средний. Проверка документации не смотрела на шесть блоков

`tests/check_docs_code_samples.py` складывал **любой** `ModuleNotFoundError` в категорию «модуль предлагается создать». Но эта ошибка приходит и тогда, когда модуль в репозитории есть, а не загружается из-за отсутствующей зависимости.

`app/tasks/email.py` и `app/tasks/cleanup.py` лежат в проекте, но импортируют `celery`, которого нет в `requirements.txt`:

```
$ python -c "import app.tasks.email"
ModuleNotFoundError: No module named 'celery'
```

Поэтому шесть блоков `docs/CELERY_REDIS_SETUP.md` — те самые, что учат импортировать имена из `app.tasks`, — не проверялись вообще, при том что проверка бодро печатала «битых ссылок 0». Это тот самый ноль по неверной причине, ради которого в скрипте и появилась самопроверка; предупреждение о нём печаталось («если это все импорты подряд — проверка опять не работает»), но ничего не валило.

Исправлено в `a6adfcd`. Скрипт различает «модуля нет на диске» (норма — рецепт предлагает его создать) и «модуль есть, но не импортируется»; во втором случае — отдельный код выхода 2 со списком модулей. Проверено в обе стороны: без `celery` код 2 и перечень из пяти блоков, с `celery` код 0.

Заодно `celery==5.5.3` добавлен в `requirements.txt`: без него модули неимпортируемы, а неимпортируемый модуль нельзя ни запустить, ни проверить. Приложению в рантайме он не нужен — ни `main.py`, ни `api/*` его не импортируют.

### D5. Критический. Группа самодостаточных наборов не могла запуститься в принципе

Уже после того, как D1 был исправлен и запушен, CI остался красным. Джоба `Backend tests`, шаг `Run self-contained regression suites`, падение **на первом же наборе**:

```
ModuleNotFoundError: No module named 'httpx'
RuntimeError: The starlette.testclient module requires the httpx package to be installed.
```

Восемь из девяти наборов этой группы поднимают приложение через `fastapi.testclient`, а тот требует `httpx`. `httpx` при этом не объявлен нигде:

```
$ pip show httpx | grep Required-by
Required-by:            ← пусто
```

То есть пакет не приходит транзитивно ни от `fastapi`, ни от `sentry-sdk[fastapi]`, ни от чего-либо ещё — он просто лежит в рабочей venv, куда попал руками. Единственный файл зависимостей, который ставит CI, — `backend/requirements.txt`, и `httpx` в нём нет.

Почему это не всплывало раньше: группа подключена ещё в `6f1c000`, но **не выполнялась ни разу** — предыдущий шаг `Run test suites` падал на пятом наборе из девяти (это D1), и `set -e` останавливал джобу раньше. Как только первый шаг починили, группа запустилась впервые в жизни и упала на входе.

По существу это значит, что восемь наборов — `repro_payment_cycle`, `repro_mobile_avatar`, `repro_upload_reject`, `check_pro_expiry`, `repro_yookassa_unpaid_credit`, `check_file_cleanup`, `repro_verification_document_access`, `check_pending_payment_recovery` — в CI не проверялись ни разу. Это ровно те наборы, что закрывают денежные дефекты (зачисление без подтверждённой оплаты, бессрочная PRO-подписка) и удаление данных (уборка осиротевших файлов, доступ к документам верификации).

Исправлено в `e034aa8`:

- `backend/requirements-dev.txt` — новый файл, начинается с `-r requirements.txt`, в нём `httpx==0.28.1`. В образ не попадает: `backend/Dockerfile` ставит только `requirements.txt`.
- Ставит его одна джоба `backend`. Проверено, что остальным четырём он не нужен: `login-throttle` гоняет `check_login_throttle.py`, у которого вообще нет сторонних импортов (только stdlib, `urllib`); `migrations` и `production-profile` — alembic и инлайн-проверки; `password-form` — Playwright.
- `cache-dependency-path` расширен на оба файла: иначе кэш `setup-python` вернул бы окружение без `httpx`, и дефект вернулся бы через прогон.

Доказательство — в чистом venv, собранном только из `requirements-dev.txt`:

```
$ pip uninstall -y httpx && python tests/repro_payment_cycle.py
RuntimeError: The starlette.testclient module requires the httpx package to be installed.
код возврата: 1

$ pip install -r backend/requirements-dev.txt && for suite in <все девять>; do python tests/$suite.py; done
  repro_payment_cycle                          OK   ИТОГ: passed=26 failed=0
  repro_mobile_avatar                          OK
  security/repro_upload_reject                 OK
  security/check_pro_expiry                    OK   ИТОГ: passed=9 failed=0
  security/repro_yookassa_unpaid_credit        OK
  security/check_file_cleanup                  OK   ИТОГ: passed=18 failed=0
  security/repro_verification_document_access  OK   ИТОГ: passed=24 failed=0
  security/check_pending_payment_recovery      OK
  security/check_online_status                 OK   ИТОГ: passed=17 failed=0
```

Отдельно проверено статическим разбором импортов в `tests/`: других незадекларированных сторонних зависимостей нет (единственное срабатывание — `import payments`, а это локальный `backend/payments.py`). Но этот разбор **не поймал бы D5**: наборы импортируют `fastapi`, а он объявлен; `httpx` нужен как транзитивное требование `fastapi.testclient`. Ловится только реальным запуском в окружении, собранном из того же файла, что ставит CI.

Мелочь, стоившая времени: текст падения **не в хвосте лога**. GitHub печатает запуск и остановку сервисных контейнеров после шага, поэтому `tail` показывает шум Postgres и Redis, а сама ошибка лежит в середине файла:

```
grep -nE "FAIL|Traceback|##\[error\]|ModuleNotFoundError" ci_log.txt
```

---

## Найдено, но не правил — решает пользователь

### O1. Средний. Подсистема Celery — мёртвый код

`app/core/celery_app.py` (расписания beat), `app/tasks/email.py` и `app/tasks/cleanup.py` — **11 задач**, включая `cleanup_orphaned_files` и `check_expired_pro_subscriptions`. Есть инструкция `docs/CELERY_REDIS_SETUP.md` на 10 блоков, `redis` в зависимостях, `docker-compose.infra.yml`.

При этом воркер **не поднимает ни один контур**: `celery` нет ни в `ecosystem.config.cjs`, ни в `docker-compose*.yml`, ни в `render.yaml`. Ничто в рантайме не импортирует `celery_app` — то есть 11 задач не выполняются никем, а `docs/CELERY_REDIS_SETUP.md` описывает то, чего в развёртывании нет.

Отдельно: `check_pro_expiry.py` в своём docstring **уже опирается** на этот факт («celery нет в requirements.txt и ни один контур развёртывания не поднимает воркер») — то есть `is_pro_active` считается по сроку именно потому, что задача снятия флага не запускается. Это осознанное решение, но оно держится на неработающей подсистеме.

Решить: поднять воркер в одном из контуров — или удалить подсистему и инструкцию, чтобы не обещать того, чего нет.

### O2. Низкий. Базовая линия CSS глушит семь мёртвых классов

Охранник `check-css-classes.mjs` находит классы в разметке, которых нет в бандле. Он зелёный: `все 8264 классов из className есть в бандле (известных пропусков: 7)`. Но семь пропусков — не «старый долг в CSS страниц товаров», как написано в комментарии CI, а живые мёртвые классы:

- **шесть классов анимации** — `animate-in`, `fade-in`, `slide-in-from-right`, `slide-in-from-bottom`, `slide-in-from-bottom-4`, `zoom-in-95`. Это утилиты плагина Tailwind Animate (`tailwindcss-animate` / `tw-animate-css`), которого нет ни в `package.json`, ни в `index.css`. Значит, анимации появления не работают: выезжающая панель фильтров (`MobileFilterDrawer.jsx:56`), выезжающие чаты (`ChatsDrawer.jsx:41`), выпадающий список городов (`CityInput.jsx:284`), карточка на карте (`TaskMap.jsx:474`) появляются мгновенно, без движения;
- **`order-date`** (`MyOrdersPage.jsx:147`) — не утилита Tailwind, а обычный класс проекта, и правила для него нет нигде. При этом у всех соседей правила есть: `.order-card`, `.order-header`, `.order-info`, `.order-meta`, `.order-id`, `.order-status`, `.order-image`, `.order-details`, `.order-actions` — все в `MyOrdersPage.css`.

Это ровно тот класс дефекта, ради которого охранник и написан (прозрачные уведомления из-за пропавшего `glass`). Разница в том, что тогда его нашёл пользователь по скриншоту, а сейчас он найден — и внесён в базовую линию через `--update`.

Решить: поставить `tw-animate-css` и добавить `@import` — или убрать мёртвые классы из разметки. Трогать визуальный слой и добавлять зависимость без спроса не стал.

### O3. Низкий. Список CSRF-покрытия отстал от роутов

`tests/test_csrf_coverage.py` перечисляет 15 эндпоинтов вручную. Новый `POST /users/me/password` (коммит `f48b2bd`) в список не добавлен. Сам эндпоинт защищён — проверяется в `check_admin_password_change.py` и в браузерной джобе, — но ручной список снова отстал от кода, а это ровно та причина, по которой в прошлый раз `POST /users/me/password` оказался вне покрытия.

Полное перечисление по приложению: **46 пишущих роутов, 4 без `verify_csrf`** — `/login`, `/logout`, `/refresh` (токена ещё нет) и `/payments/webhook/yoomoney` (подпись HMAC). Все четыре — by design, лишних нет.

### O4. Низкий. Мелочи

- `decode_token_or_401` определена **14 раз**, одной строкой в каждом модуле `app/api/*`. Не дефект, но `user_online` тоже начиналась как две копии — и разошлась.
- `app/core/container.py` — мёртвый код: его никто не импортирует, а `get_db` дублирует `database.py`.
- `seed_demo.py:643` печатает пароль админа в stdout. В CI это попадает в лог джобы. `check_admin_password_change.py` тот же пароль намеренно не печатает («значение не печатаем: вывод попадает в логи CI») — то есть в проекте есть обе практики, и это несогласованность.

---

## Что осталось непроверенным

- **PostgreSQL.** Локальный Postgres 18 запущен, но пароль не подобран, прогон шёл на SQLite. SQLite уже маскировал дефекты в этом проекте (три дефекта миграций из комментария в `ci.yml`). Джоба `migrations` и прогон на PG проверяются только в CI.
- **Браузерные джобы.** `password-form` требует Playwright и живой Vite — локально не поднимал. `agent-browser` на Windows не поддерживается.
- **`login-throttle`** проверен локально вручную (6/6), но с лимитером в памяти процесса: Redis недоступен, а в CI он есть.

---

## Изменённые файлы

| Файл | Что |
|---|---|
| `tests/_helpers.py` | общий резолвер `demo_password()` / `admin_password()` |
| `tests/e2e_new_features_test.py` | пароль админа из резолвера, SKIP → FAIL |
| `tests/repro_chat_attachment_base64.py` | убран хардкод `AuditPass_2026x` |
| `tests/security/repro_files_public_access.py` | то же |
| `backend/app/core/presence.py` | **новый**: одна реализация `user_online` |
| `backend/app/api/users.py`, `responses.py` | копии удалены, импорт из `presence` |
| `backend/app/api/admin.py` | окно онлайна из общей константы |
| `backend/main.py` | в `last_seen` пишется naive UTC |
| `tests/security/check_online_status.py` | **новый**: регресс, 17 проверок |
| `tests/check_docs_code_samples.py` | различает «нет модуля» и «не импортируется», код 2 |
| `backend/requirements.txt` | `celery==5.5.3` |
| `backend/requirements-dev.txt` | **новый**: `httpx==0.28.1` поверх `requirements.txt` |
| `.github/workflows/ci.yml` | новый набор в группе 2; джоба `backend` ставит dev-зависимости |

Коммиты: `528dc75`, `d472ae1`, `a6adfcd`, `e034aa8` — запушены в `main`.
