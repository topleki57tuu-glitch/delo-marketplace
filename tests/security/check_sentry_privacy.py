"""
Регресс: Sentry включается на VPS, ловит ошибки API и фоновых задач и не
получает персональных данных.

Запуск (из корня репозитория):
    python tests/security/check_sentry_privacy.py

Код возврата: 0 — всё сходится, 1 — расхождение. Сеть не нужна: события
перехватываются подменённым транспортом, до sentry.io ничего не доходит.

Почему этот файл существует
---------------------------
Инициализация Sentry была только в main.py, а SENTRY_DSN в
docker-compose.prod.yml не передавался: включить его на VPS было нельзя, а
воркер и beat Celery не подключили бы его и после этого. Кроме того,
send_default_pii=False не выключает тела запросов и переменные из стека —
в Sentry, сервис за рубежом, ушли бы паспортные данные и реквизиты из
тела запроса, на котором упал код.

Что проверяется
---------------
1. docker-compose.prod.yml передаёт SENTRY_DSN backend, worker и beat;
2. ошибка API попадает в Sentry с тегом component=backend;
3. в событии нет тела запроса, Authorization, cookies, IP, значений
   переменных из стека, строк журнала с IP-адресами и значений из строки
   запроса (?refresh_token=…) — их SDK отправляет при любых настройках;
4. ошибка, записанная в журнал (logger.error), тоже уходит событием — без
   почты и токенов из текста; параметры SQL из текста ошибки вычищаются;
5. сигналы запуска Celery подключают Sentry с тегами worker и beat;
6. упавшая задача уходит без своих аргументов: у задачи писем это адрес
   и ссылка сброса пароля с токеном;
7. без SENTRY_DSN ничего не подключается.
"""
import json
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BACKEND = os.path.join(REPO_ROOT, "backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

FAKE_DSN = "https://public@sentry.invalid/1"
isolate_env("check_sentry_privacy", SENTRY_DSN=FAKE_DSN, SENTRY_TRACES_SAMPLE_RATE="0")

import sentry_sdk  # noqa: E402
from sentry_sdk.transport import Transport  # noqa: E402

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


class CapturingTransport(Transport):
    """Складывает события в список вместо отправки на sentry.io."""

    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type in ("event", "transaction") and item.payload.json:
                self.events.append(item.payload.json)

    def flush(self, timeout, callback=None):
        return None


transport = CapturingTransport()
_real_init = sentry_sdk.init


def _init_with_capture(*args, **kwargs):
    kwargs["transport"] = transport
    return _real_init(*args, **kwargs)


sentry_sdk.init = _init_with_capture

print("РЕГРЕСС: Sentry на VPS — включается и не получает персональных данных")

print("\n1. docker-compose.prod.yml")
import yaml  # noqa: E402

with open(os.path.join(REPO_ROOT, "docker-compose.prod.yml"), encoding="utf-8") as fh:
    compose = yaml.safe_load(fh)
for service in ("backend", "worker", "beat"):
    env = compose["services"][service].get("environment") or {}
    check(f"{service}: SENTRY_DSN передаётся", "SENTRY_DSN" in env, str(env.get("SENTRY_DSN")))

print("\n2. Ошибка API")
from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.logging import logger  # noqa: E402

PASSPORT = "4510 777666"
CLIENT_IP = "203.0.113.77"
# Склеено, чтобы значения не было в исходном тексте рядом с упавшим кодом:
# Sentry прикладывает к стеку соседние строки исходника.
QUERY_SECRET = "secret-" + "query-token"


@main.app.post("/__sentry_check")
async def _boom(request: Request):
    payload = await request.json()
    passport_number = payload["passport"]  # noqa: F841 — локальная переменная для проверки стека
    logger.info(f"request from {CLIENT_IP}")
    raise RuntimeError("sentry-check: падение обработчика")


client = TestClient(main.app, raise_server_exceptions=False)
resp = client.post(
    f"/__sentry_check?refresh_token={QUERY_SECRET}&page=2",
    json={"passport": PASSPORT, "requisites": "40817810000000000001"},
    headers={"Authorization": "Bearer secret-token-value", "X-Forwarded-For": CLIENT_IP},
    cookies={"session": "secret-cookie-value"},
)
check("обработчик упал с 500", resp.status_code == 500, f"http={resp.status_code}")
sentry_sdk.flush()

errors = [e for e in transport.events if e.get("exception")]
event = next((e for e in errors if "sentry-check" in json.dumps(e, ensure_ascii=False)), None)
check("событие ушло в Sentry", event is not None, f"событий: {len(transport.events)}")
event = event or {}
dumped = json.dumps(event, ensure_ascii=False)
check("тег component=backend", (event.get("tags") or {}).get("component") == "backend", str(event.get("tags")))
check("environment из окружения", bool(event.get("environment")), str(event.get("environment")))
request_info = event.get("request") or {}
check("адрес запроса есть — его хватает для разбора", "/__sentry_check" in str(request_info.get("url")),
      str(request_info.get("url")))
check("тела запроса нет", "data" not in request_info or not request_info.get("data"), str(request_info.get("data"))[:80])
check("паспортных данных нет нигде в событии", PASSPORT not in dumped)
check("реквизитов нет нигде в событии", "40817810000000000001" not in dumped)
headers = {k.lower(): v for k, v in (request_info.get("headers") or {}).items()}
# Sentry оставляет имя заголовка, а значение заменяет на [Filtered]
check("значения Authorization нет", "secret-token-value" not in dumped,
      str(headers.get("authorization")))
check("cookies нет", not request_info.get("cookies") and "secret-cookie-value" not in dumped)
check("IP клиента нет", CLIENT_IP not in dumped and not (event.get("user") or {}).get("ip_address"),
      str(event.get("user")))
frames = [f for exc in (event.get("exception") or {}).get("values", [])
          for f in (exc.get("stacktrace") or {}).get("frames", [])]
check("стек есть", bool(frames), f"кадров: {len(frames)}")
check("значений переменных из стека нет", not any(f.get("vars") for f in frames))
check("строка запроса — только имена параметров",
      QUERY_SECRET not in dumped and request_info.get("query_string") == "refresh_token=[Filtered]&page=[Filtered]",
      str(request_info.get("query_string")))

print("\n3. Ошибка из журнала и текст ошибок")
EMAIL = "ivan.petrov@example.com"
RESET_TOKEN = "reset-secret-123"
transport.events.clear()
logger.error(f"sentry-check: ошибка из журнала, письмо на {EMAIL}, "
             f"https://xn--d1acsm.online/reset-password?token={RESET_TOKEN}")
sentry_sdk.flush()
log_dump = json.dumps(transport.events, ensure_ascii=False)
check("logger.error уходит событием", "sentry-check: ошибка из журнала" in log_dump,
      f"событий: {len(transport.events)}")
check("  ...без почты из текста", EMAIL not in log_dump and "[email]" in log_dump)
check("  ...без токена из ссылки", RESET_TOKEN not in log_dump and "token=[Filtered]" in log_dump)

transport.events.clear()
sql_error = RuntimeError(
    "(psycopg2.errors.UniqueViolation) duplicate key value\n"
    f"DETAIL:  Key (email)=({EMAIL}) already exists.\n"
    "[SQL: UPDATE users SET passport=%(passport)s WHERE users.id = %(id_1)s]\n"
    f"[parameters: {{'passport': '{PASSPORT}', 'id_1': 7}}]\n"
    "(Background on this error at: https://sqlalche.me/e/20/gkpj)")
sentry_sdk.capture_exception(sql_error)
sentry_sdk.flush()
sql_dump = json.dumps(transport.events, ensure_ascii=False)
check("ошибка SQLAlchemy уходит, текст запроса на месте", "UPDATE users SET passport" in sql_dump,
      f"событий: {len(transport.events)}")
check("  ...без значений параметров и Key (…)=(…)", PASSPORT not in sql_dump and EMAIL not in sql_dump)


print("\n4. Воркер и beat Celery")
PROBE = r"""
import json, sys
sys.path.insert(0, %(backend)r)
import sentry_sdk
from app.core.celery_app import celery_app
from celery.signals import beat_init, celeryd_init
signal = celeryd_init if sys.argv[1] == "worker" else beat_init
signal.send(sender="check", instance=None, conf=celery_app.conf, options={})
client = sentry_sdk.get_client()
tags = sentry_sdk.get_global_scope()._tags
print(json.dumps({"active": client.is_active(), "component": tags.get("component"),
                  "body": client.options.get("max_request_body_size"),
                  "locals": client.options.get("include_local_variables"),
                  "pii": client.options.get("send_default_pii")}))
""" % {"backend": BACKEND}


def probe(component: str, dsn: str) -> dict:
    env = dict(os.environ, SENTRY_DSN=dsn)
    out = subprocess.run([sys.executable, "-c", PROBE, component], cwd=BACKEND, env=env,
                         capture_output=True, text=True, timeout=120)
    try:
        return json.loads(out.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return {"error": (out.stderr or out.stdout)[-300:]}


for component in ("worker", "beat"):
    info = probe(component, FAKE_DSN)
    check(f"{component}: Sentry подключён с тегом {component}",
          info.get("active") is True and info.get("component") == component, json.dumps(info, ensure_ascii=False))
    check(f"{component}: те же ограничения (без тел, переменных, ПДн)",
          info.get("body") == "never" and info.get("locals") is False and info.get("pii") is False,
          json.dumps(info, ensure_ascii=False))

print("\n5. Упавшая задача Celery")
PROBE_TASK = r"""
import json, sys
sys.path.insert(0, %(backend)r)
import sentry_sdk
from sentry_sdk.transport import Transport

events = []


class CapturingTransport(Transport):
    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event" and item.payload.json:
                events.append(item.payload.json)

    def flush(self, timeout, callback=None):
        return None


_init = sentry_sdk.init


def _init_with_capture(*args, **kwargs):
    kwargs["transport"] = CapturingTransport()
    return _init(*args, **kwargs)


sentry_sdk.init = _init_with_capture
from app.core.celery_app import celery_app
from app.core.logging import logger
from celery.signals import celeryd_init
celeryd_init.send(sender="check", instance=None, conf=celery_app.conf, options={})


@celery_app.task(name="check.send_password_reset")
def send_password_reset(to, link):
    logger.error(f"sentry-check: письмо не ушло на {to}")
    raise RuntimeError(f"sentry-check: SMTP недоступен, ссылка {link}")


send_password_reset.apply(args=(%(email)r, "https://xn--d1acsm.online/reset-password?token=" + %(token)r))
sentry_sdk.flush()
print(json.dumps(events, ensure_ascii=False))
""" % {"backend": BACKEND, "email": EMAIL, "token": RESET_TOKEN}

out = subprocess.run([sys.executable, "-c", PROBE_TASK], cwd=BACKEND, env=dict(os.environ, SENTRY_DSN=FAKE_DSN),
                     capture_output=True, text=True, timeout=120)
try:
    task_events = json.loads(out.stdout.strip().splitlines()[-1])
except (IndexError, ValueError):
    task_events = []
    print((out.stderr or out.stdout)[-500:])
task_dump = json.dumps(task_events, ensure_ascii=False)
job = next(((e.get("extra") or {}).get("celery-job") for e in task_events
            if (e.get("extra") or {}).get("celery-job")), None) or {}
check("ошибка задачи уходит с именем задачи и тегом worker",
      job.get("task_name") == "check.send_password_reset"
      and any((e.get("tags") or {}).get("component") == "worker" for e in task_events),
      f"событий: {len(task_events)}")
check("  ...без аргументов задачи", job.get("args") == "[Filtered]" and job.get("kwargs") == "[Filtered]",
      str(job)[:120])
check("  ...ни адреса, ни токена сброса пароля нигде в событиях",
      bool(task_events) and EMAIL not in task_dump and RESET_TOKEN not in task_dump)

print("\n6. Без SENTRY_DSN")
info = probe("worker", "")
check("без DSN ничего не подключается", info.get("active") is False and info.get("component") is None,
      json.dumps(info, ensure_ascii=False))

print()
print(f"Проверок: {passed + failed}, провалено: {failed}")
sys.exit(1 if failed else 0)
