"""
Регресс: подсистема фоновых задач (Celery) действительно работает.

Запуск (из корня репозитория):
    python tests/security/check_celery_tasks.py

Код возврата: 0 — задачи выполняются, расписание полное, контуры поднимают
воркер и beat; 1 — что-то из этого не так.

Почему этот файл существует
---------------------------
В проекте 12 задач Celery, и до этого разбора **ни одна из них не выполнялась
никогда**: воркера не было ни в docker-compose.prod.yml, ни в render.yaml, ни
в ecosystem.config.cjs. Подсистема существовала только в коде — и за время
такого существования накопила три независимых поломки, каждая из которых
всплывала бы на первом же запуске:

1. **Адрес брокера был неразбираемым.** `CELERY_BROKER_URL` собирался как
   `f"{REDIS_URL}/1"`, а `REDIS_URL` в контуре по умолчанию уже содержит базу
   (`redis://redis:6379/0`). Получалось `redis://redis:6379/0/1`, kombu читал
   хвост как имя базы (`virtual_host = "0/1"`), и `int("0/1")` падал с
   `ValueError`. Причём падало это не при старте и не при запуске воркера,
   а при первой отправке задачи — то есть подсистема выглядела рабочей ровно
   до того момента, когда её впервые пытались использовать.

2. **`cleanup_old_notifications` падала на каждом запуске.** Обращалась к
   `Notification.read`, а колонка называется `is_read`. Обращение к
   несуществующему атрибуту происходит при построении запроса, до базы.

3. **`vacuum_database` падала на каждом запуске.** `db.execute("VACUUM")` —
   в SQLAlchemy 2.0 голая строка не исполняемое выражение:

       ObjectNotExecutableError: Not an executable object: 'VACUUM'

   (`ObjectNotExecutableError` — подкласс `ArgumentError`, поэтому в старых
   версиях текст был `ArgumentError: Textual SQL expression 'VACUUM' should be
   explicitly declared as text('VACUUM')`. Проверено на SQLAlchemy 2.0.46:
   класс именно `ObjectNotExecutableError`.) Не работала ни разу за всё время.

Плюс две задачи по расписанию — `cleanup_expired_password_reset_tokens` и
`cleanup_expired_refresh_tokens` — не были перечислены в `beat_schedule`.
Они работали, но их никто не вызывал: истёкшие токены сброса пароля и
refresh-токены накапливались в таблицах бессрочно.

Что здесь проверяется и почему именно так
-----------------------------------------
**Задачи выполняются по-настоящему.** Не «модуль импортируется», а каждая
задача запускается синхронно (`.apply()` с `task_always_eager`) на временной
базе. Именно так ловятся дефекты 2 и 3: и то и другое — падение в момент
исполнения, которое не видно ни при импорте, ни при чтении кода.

**Набор задач сверяется целиком.** Тест падает, если задача появилась или
исчезла: список ниже — это решение, а не наблюдение. Новая задача обязана
попасть в таблицу вызовов, иначе она окажется ровно в том положении, из
которого этот файл и появился, — «есть в коде, не выполняется никем».

**Адрес брокера разбирается тем же кодом, что и в бою** (`kombu.Connection`),
а не сравнением строк: сравнение `"redis://redis:6379/1" == ...` прошло бы и
на адресе, который kombu не принимает.

**Расписание beat проверяется на опечатки.** Имена задач в `beat_schedule` —
это строки, и celery их никак не валидирует: опечатка даёт задачу, которая
молча не запускается. Отдельно проверяется, что модуль с задачами попал в
`include` — модуль, которого там нет, воркер не загрузит.

**Контуры развёртывания сверяются между собой.** Воркер объявлен в трёх
контурах, и набор переменных у него должен совпадать с backend: переменная,
добавленная только бэкенду (так уже случилось с YOOMONEY_* и ADMIN_EMAILS),
для воркера не существует, а задача падает не при старте, а при исполнении.
"""
import glob
import os
import re
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет боевой DATABASE_URL и живой
# REDIS_URL, через setdefault их не перекрыть (см. isolate_env).
#
# REDIS_URL здесь намеренно с номером базы `/0` — ровно такой он в контурах
# развёртывания. Это и есть условие воспроизведения дефекта с брокером: на
# адресе без номера базы дописывание `/1` работает.
#
# SMTP задаём пустым явно. Не «на всякий случай»: проверка сброса пароля ниже
# утверждает, что письмо НЕ ушло и ссылка вернулась в ответе. Если у того, кто
# запускает набор, в окружении лежит рабочий SMTP_HOST (свой .env, чужая
# джоба), письмо уйдёт по-настоящему, ссылки в ответе не будет, и набор
# упадёт не из-за дефекта.
#
# SMTP_PORT при этом задаём числом, а не пустой строкой: `smtp_settings()`
# разбирает порт до проверки на пустые host/user/password, и `int("")` уронил
# бы отправку другим исключением — то есть проверка прошла бы по неверной
# причине.
isolate_env(
    "check_celery_tasks",
    SMTP_HOST="",
    SMTP_USER="",
    SMTP_PASS="",
    SMTP_FROM="",
    SMTP_PORT="587",
)

from celery.schedules import crontab  # noqa: E402
from kombu import Connection  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401  — регистрирует таблицы в Base.metadata

Base.metadata.create_all(bind=engine)

from app.core.celery_app import (  # noqa: E402
    CELERY_BROKER_URL,
    CELERY_RESULT_BACKEND,
    REDIS_URL,
    _redis_db,
    celery_app,
)
import app.tasks.cleanup  # noqa: E402,F401  — регистрирует задачи
import app.tasks.email  # noqa: E402,F401

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# Что именно запускаем. Ключ — имя задачи, значение — аргументы вызова.
#
# Это список решений, а не наблюдение: задача, которой здесь нет, не будет
# запущена, а тест упадёт на сверке набора. Так новая задача не сможет тихо
# оказаться в положении «есть в коде, не выполняется никем».
# ---------------------------------------------------------------------------
TASK_CALLS = {
    "celery.ping": (),
    "app.tasks.email.send_email": ("reader@check.ru", "Тема", "Тело письма"),
    "app.tasks.email.send_password_reset": ("reader@check.ru", "reset-token"),
    "app.tasks.email.send_notification_email": ("reader@check.ru", "Вас выбрали", "Текст", 1),
    "app.tasks.email.send_bulk_emails": (["a@check.ru", "b@check.ru"], "Анонс", "Текст"),
    "app.tasks.cleanup.cleanup_old_notifications": (),
    "app.tasks.cleanup.cleanup_expired_csrf_tokens": (),
    "app.tasks.cleanup.cleanup_expired_password_reset_tokens": (),
    "app.tasks.cleanup.cleanup_expired_refresh_tokens": (),
    "app.tasks.cleanup.check_expired_pro_subscriptions": (),
    "app.tasks.cleanup.vacuum_database": (),
    "app.tasks.cleanup.cleanup_orphaned_files": (),
}

# Задачи, которые по расписанию СОЗНАТЕЛЬНО не идут. Не «забыли добавить»,
# а решение, и каждое записано в комментарии к `beat_schedule` в
# app/core/celery_app.py:
#
#   cleanup_orphaned_files — удаляет данные, только вручную.
#     Регресс — check_file_cleanup.py.
#   vacuum_database — на PostgreSQL пропускается сама (autovacuum), на SQLite
#     берёт эксклюзивную блокировку на минуты, то есть на живой базе это
#     отказ в обслуживании.
#
# Этот список — не «наблюдение по факту». Если задача выпадет из расписания
# случайно, она окажется здесь не перечисленной и попадёт в отчёт как забытая;
# ровно так и нашлась vacuum_database.
UNSCHEDULED_BY_DESIGN = {
    "app.tasks.cleanup.cleanup_orphaned_files": "удаляет данные, только вручную",
    "app.tasks.cleanup.vacuum_database": "блокирует базу на минуты, в бою PostgreSQL",
}

# Фреймворковые задачи celery.* (backend_cleanup и прочие) исключены: они
# требуют живого бэкенда результатов и к проекту отношения не имеют.
registered = {
    name for name in celery_app.tasks
    if name.startswith("app.tasks.") or name == "celery.ping"
}

print("=" * 68)
print("ПРОВЕРКА: подсистема фоновых задач (Celery) работает")
print("=" * 68)

# ---------------------------------------------------------------------------
print("\n1. Адрес брокера: номер базы заменяется, а не дописывается")
# ---------------------------------------------------------------------------
check(
    "номер базы в адресе заменяется",
    _redis_db("redis://redis:6379/0", 1) == "redis://redis:6379/1",
    f"получено {_redis_db('redis://redis:6379/0', 1)!r}",
)
check(
    "адрес без номера базы получает номер",
    _redis_db("redis://redis:6379", 2) == "redis://redis:6379/2",
    f"получено {_redis_db('redis://redis:6379', 2)!r}",
)

# Демонстрация того, что проверка вообще способна упасть: старая схема
# (дописать номер) даёт адрес, который kombu не принимает.
legacy_vh = Connection(f"{REDIS_URL}/1").info().get("virtual_host")
try:
    int(legacy_vh)
    legacy_breaks = False
except ValueError:
    legacy_breaks = True
check(
    "старая схема действительно ломается (проверка с зубами)",
    legacy_breaks,
    f"virtual_host={legacy_vh!r}",
)

for label, url in (("брокер", CELERY_BROKER_URL), ("результаты", CELERY_RESULT_BACKEND)):
    vh = Connection(url).info().get("virtual_host")
    try:
        db_number = int(vh)
        ok = True
    except (TypeError, ValueError):
        db_number = None
        ok = False
    check(
        f"{label}: адрес разбирается kombu, номер базы — целое",
        ok,
        f"url={url} virtual_host={vh!r}",
    )

def db_number(url: str):
    """Номер базы Redis из адреса — или None, если адрес неразбираем.

    Возврат None вместо исключения здесь принципиален. Набор должен показать
    ВСЕ расхождения за один прогон: если дать `int(...)` упасть, он оборвётся
    на первой же проверке адреса и не дойдёт ни до задач, ни до расписания,
    ни до контуров — то есть по отчёту нельзя будет понять, что ещё сломано.
    Ровно так и произошло при проверке на откаченных фиксах.
    """
    try:
        return int(Connection(url).info()["virtual_host"])
    except (KeyError, TypeError, ValueError):
        return None


check(
    "брокер не совпадает со старым (сломанным) адресом",
    CELERY_BROKER_URL != f"{REDIS_URL}/1",
    f"broker={CELERY_BROKER_URL}",
)

broker_db = db_number(CELERY_BROKER_URL)
result_db = db_number(CELERY_RESULT_BACKEND)
check(
    "брокер, результаты и кэш приложения — в разных базах Redis",
    None not in (broker_db, result_db) and len({broker_db, result_db, 0}) == 3,
    f"кэш=0 брокер={broker_db} результаты={result_db}",
)

# ---------------------------------------------------------------------------
print("\n2. Набор зарегистрированных задач")
# ---------------------------------------------------------------------------
expected = set(TASK_CALLS)
check(
    "зарегистрированы ровно те задачи, что перечислены в этом файле",
    registered == expected,
    "" if registered == expected
    else f"лишние={sorted(registered - expected)} пропущены={sorted(expected - registered)}",
)
check(
    "в наборе есть задачи обеих групп — почта и уборка",
    any(n.startswith("app.tasks.email.") for n in registered)
    and any(n.startswith("app.tasks.cleanup.") for n in registered),
    f"всего={len(registered)}",
)

# Модуль с задачами, которого нет в `include`, воркер не загрузит — и задачи
# из него не будут зарегистрированы ни в одном контуре.
task_modules = []
for path in sorted(glob.glob(os.path.join(REPO_ROOT, "backend", "app", "tasks", "*.py"))):
    stem = os.path.splitext(os.path.basename(path))[0]
    if stem == "__init__":
        continue
    with open(path, encoding="utf-8") as fh:
        if "celery_app.task" in fh.read():
            task_modules.append(f"app.tasks.{stem}")

include = list(celery_app.conf.include or [])
missing_include = sorted(set(task_modules) - set(include))
check(
    "все модули с задачами перечислены в include",
    not missing_include,
    f"include={include} нет={missing_include}" if missing_include else f"include={include}",
)

# ---------------------------------------------------------------------------
print("\n3. Каждая задача выполняется без ошибки")
# ---------------------------------------------------------------------------
# Синхронный режим: задача исполняется здесь же, без брокера и без воркера.
# Без него `send_password_reset_email` и `send_notification_email` пытались бы
# отправить задачу в очередь — то есть проверка конфигурации зависела бы от
# того, поднят ли Redis.
celery_app.conf.task_always_eager = True
celery_app.conf.task_eager_propagates = True

results = {}
for name in sorted(registered):
    task = celery_app.tasks[name]
    try:
        outcome = task.apply(args=TASK_CALLS[name])
        results[name] = outcome.result
        error = None
    except Exception as exc:  # noqa: BLE001 — показываем класс и текст
        results[name] = None
        error = f"{type(exc).__name__}: {exc}"
    check(
        f"{name} выполняется",
        error is None,
        error or f"результат={results[name]!r}"[:120],
    )

# Точечные проверки на то, что задача не просто «не упала», а сделала то,
# что должна: `except Exception` внутри задач мог бы проглотить поломку.
check(
    "cleanup_old_notifications вернула счётчик удалённых",
    isinstance(results.get("app.tasks.cleanup.cleanup_old_notifications"), dict)
    and "deleted" in results["app.tasks.cleanup.cleanup_old_notifications"],
    f"результат={results.get('app.tasks.cleanup.cleanup_old_notifications')!r}",
)
check(
    "vacuum_database отработала, а не упала на текстовом SQL",
    isinstance(results.get("app.tasks.cleanup.vacuum_database"), dict)
    and results["app.tasks.cleanup.vacuum_database"].get("status") in {"completed", "skipped"},
    f"результат={results.get('app.tasks.cleanup.vacuum_database')!r}",
)
check(
    "письмо без настроенного SMTP не ретраится, а честно говорит об этом",
    isinstance(results.get("app.tasks.email.send_email"), dict)
    and results["app.tasks.email.send_email"].get("status") == "not_configured",
    f"результат={results.get('app.tasks.email.send_email')!r}",
)

# ---------------------------------------------------------------------------
print("\n4. Расписание beat")
# ---------------------------------------------------------------------------
beat = dict(celery_app.conf.beat_schedule or {})
scheduled = {entry["task"] for entry in beat.values()}

unknown = sorted(scheduled - registered)
check(
    "все задачи из расписания существуют (опечатка = молча не запускается)",
    not unknown,
    f"нет таких задач: {unknown}" if unknown else f"записей={len(beat)}",
)

cleanup_tasks = sorted(n for n in registered if n.startswith("app.tasks.cleanup."))
forgotten = [
    n for n in cleanup_tasks
    if n not in scheduled and n not in UNSCHEDULED_BY_DESIGN
]
check(
    "каждая задача уборки либо в расписании, либо сознательно вне его",
    not forgotten,
    f"забыты: {forgotten}" if forgotten else f"уборок={len(cleanup_tasks)}",
)

stale = sorted(set(UNSCHEDULED_BY_DESIGN) - registered)
check(
    "список «сознательно вне расписания» не содержит исчезнувших задач",
    not stale,
    f"устаревшие записи: {stale}" if stale else f"вне расписания={len(UNSCHEDULED_BY_DESIGN)}",
)

both = sorted(set(UNSCHEDULED_BY_DESIGN) & scheduled)
check(
    "задача не может быть одновременно в расписании и «вне расписания»",
    not both,
    f"противоречие: {both}" if both else "",
)

# Именно эти две были в коде, работали и не запускались никем.
for name in (
    "app.tasks.cleanup.cleanup_expired_password_reset_tokens",
    "app.tasks.cleanup.cleanup_expired_refresh_tokens",
):
    check(
        f"{name.split('.')[-1]} в расписании",
        name in scheduled,
        "не найдена в beat_schedule" if name not in scheduled else "",
    )

bad_schedule = sorted(
    key for key, entry in beat.items()
    if not isinstance(entry.get("schedule"), crontab)
)
check(
    "расписание задано crontab, а не числом секунд",
    not bad_schedule,
    f"не crontab: {bad_schedule}" if bad_schedule else "",
)

# ---------------------------------------------------------------------------
print("\n5. Контуры развёртывания поднимают и воркер, и beat")
# ---------------------------------------------------------------------------
try:
    import yaml
except ImportError:
    yaml = None

COMPOSE = os.path.join(REPO_ROOT, "docker-compose.prod.yml")
RENDER = os.path.join(REPO_ROOT, "render.yaml")
PM2 = os.path.join(REPO_ROOT, "ecosystem.config.cjs")


def load_yaml(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def pm2_block(src: str, name: str) -> str:
    """Текст одного app-блока PM2 по имени приложения."""
    marker = f"name: '{name}'"
    start = src.find(marker)
    if start == -1:
        return ""
    nxt = src.find("name: '", start + len(marker))
    return src[start:nxt if nxt != -1 else len(src)]


if yaml is None:
    check(
        "PyYAML доступен для разбора контуров",
        False,
        "pip install -r backend/requirements-dev.txt",
    )
else:
    compose = load_yaml(COMPOSE)
    services = compose["services"]

    for name, verb in (("worker", "worker"), ("beat", "beat")):
        service = services.get(name)
        check(f"docker-compose: сервис {name} объявлен", service is not None)
        if service:
            command = service.get("command") or ""
            check(
                f"docker-compose: {name} запускает celery {verb}",
                f"celery -A app.core.celery_app {verb}" in command,
                f"command={command!r}",
            )

    if services.get("beat"):
        beat_command = services["beat"].get("command") or ""
        check(
            "docker-compose: у beat задан путь к файлу расписания",
            "--schedule=" in beat_command,
            f"command={beat_command!r}",
        )
        check(
            "docker-compose: под beat примонтирован том под расписание",
            any("beat" in str(v).lower() for v in (services["beat"].get("volumes") or [])),
            f"volumes={services['beat'].get('volumes')}",
        )

    anchor = set((compose.get("x-backend-env") or {}).keys())
    backend_env = set((services["backend"].get("environment") or {}).keys())
    check(
        "docker-compose: набор переменных в якоре совпадает с backend",
        anchor == backend_env,
        f"якорь={len(anchor)} backend={len(backend_env)} "
        f"разница={sorted(anchor ^ backend_env)}",
    )
    for name in ("worker", "beat"):
        if not services.get(name):
            continue
        env = set((services[name].get("environment") or {}).keys())
        check(
            f"docker-compose: у {name} тот же набор переменных, что у backend",
            env == backend_env,
            f"{name}={len(env)} backend={len(backend_env)} разница={sorted(env ^ backend_env)}",
        )

    render = load_yaml(RENDER)
    by_name = {s["name"]: s for s in render["services"]}
    backend_keys = {v["key"] for v in (by_name["marketplace-backend"].get("envVars") or [])}

    for name, verb in (("marketplace-worker", "worker"), ("marketplace-beat", "beat")):
        service = by_name.get(name)
        check(f"render.yaml: сервис {name} объявлен", service is not None)
        if not service:
            continue
        check(
            f"render.yaml: {name} имеет тип worker, а не web",
            service.get("type") == "worker",
            f"type={service.get('type')}",
        )
        check(
            f"render.yaml: {name} запускает celery {verb}",
            f"celery -A app.core.celery_app {verb}" in (service.get("startCommand") or ""),
            f"startCommand={service.get('startCommand')!r}",
        )
        keys = {v["key"] for v in (service.get("envVars") or [])}
        check(
            f"render.yaml: у {name} тот же набор переменных, что у backend",
            keys == backend_keys,
            f"{name}={len(keys)} backend={len(backend_keys)} разница={sorted(keys ^ backend_keys)}",
        )

    with open(PM2, encoding="utf-8") as fh:
        pm2_src = fh.read()

    for name in ("celery-worker", "celery-beat"):
        block = pm2_block(pm2_src, name)
        check(f"ecosystem.config.cjs: приложение {name} объявлено", bool(block))
        if block:
            check(
                f"ecosystem.config.cjs: {name} запускает celery",
                re.search(r"args:\s*'[^']*celery[^']*'", block) is not None
                or "celery" in block,
                "",
            )
            check(
                f"ecosystem.config.cjs: у {name} ровно один экземпляр",
                re.search(r"instances:\s*1\b", block) is not None,
                "два воркера или два beat боролись бы за одни задачи",
            )

# ---------------------------------------------------------------------------
print("\n6. Почта: одна реализация, и API не тянет брокер")
# ---------------------------------------------------------------------------
app_dir = os.path.join(REPO_ROOT, "backend", "app")
smtp_files = []
for path in glob.glob(os.path.join(app_dir, "**", "*.py"), recursive=True):
    with open(path, encoding="utf-8") as fh:
        if "smtplib" in fh.read():
            smtp_files.append(os.path.relpath(path, REPO_ROOT).replace("\\", "/"))

check(
    "SMTP-клиент существует ровно в одном месте",
    smtp_files == ["backend/app/core/email.py"],
    f"найдено: {smtp_files}",
)

auth_path = os.path.join(app_dir, "api", "auth.py")
with open(auth_path, encoding="utf-8") as fh:
    auth_src = fh.read()

check(
    "app/api/auth.py не импортирует celery",
    "celery" not in auth_src,
    "иначе API-процесс требует брокера ради отправки письма",
)
check(
    "app/api/auth.py берёт отправку из app.core.email",
    "from app.core.email import" in auth_src,
    "",
)

# ---------------------------------------------------------------------------
print("\n7. Сброс пароля после объединения SMTP в один модуль")
# ---------------------------------------------------------------------------
# Смысл проверки. `forgot_password` перестал пользоваться своей копией
# SMTP-клиента и зовёт `app.core.email.send_email_sync`. Проверяется не факт
# вызова, а весь путь: письмо не ушло → в development ссылка вернулась в
# ответе → по токену из неё пароль действительно сменился → новый работает,
# старый нет. Ошибка в рефакторинге дала бы пустую ссылку или непринятый
# токен, а не «не тот импорт» — то есть проверка ловит последствие, а не
# форму записи.
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app, raise_server_exceptions=False)

RESET_EMAIL = "reset-flow@check.ru"
OLD_PASSWORD = "Old_Passw0rd!2026"
NEW_PASSWORD = "New_Passw0rd!2026"

r = client.post(
    "/register/",
    json={"email": RESET_EMAIL, "password": OLD_PASSWORD, "name": "Сброс"},
)
check(
    "аккаунт для проверки сброса создан",
    r.status_code == 200,
    f"http={r.status_code} {r.text[:120]}",
)

r = client.post("/auth/forgot-password", json={"email": RESET_EMAIL})
check("запрос сброса прошёл", r.status_code == 200, f"http={r.status_code}")

link = (r.json().get("dev_reset_link") or "") if r.status_code == 200 else ""
check(
    "без настроенного SMTP ссылка вернулась в ответе (development)",
    "/reset?token=" in link,
    f"dev_reset_link={link[:80]!r}",
)

reset_token = link.split("token=", 1)[1] if "token=" in link else ""
r = client.post(
    "/auth/reset-password",
    json={"token": reset_token, "new_password": NEW_PASSWORD},
)
check(
    "токен из письма принимается",
    r.status_code == 200,
    f"http={r.status_code} {r.text[:120]}",
)

r = client.post("/login", data={"username": RESET_EMAIL, "password": NEW_PASSWORD})
check("новый пароль работает", r.status_code == 200, f"http={r.status_code}")

r = client.post("/login", data={"username": RESET_EMAIL, "password": OLD_PASSWORD})
check("старый пароль больше не работает", r.status_code == 401, f"http={r.status_code}")

# Ответ не должен выдавать, существует ли аккаунт: иначе это перебор адресов.
r = client.post("/auth/forgot-password", json={"email": "nobody-here@check.ru"})
check(
    "несуществующий адрес: тот же ответ и никакой ссылки",
    r.status_code == 200 and not r.json().get("dev_reset_link"),
    f"http={r.status_code} dev_reset_link={r.json().get('dev_reset_link') if r.status_code == 200 else '—'}",
)

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
