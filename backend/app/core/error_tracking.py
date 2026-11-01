"""
Ошибки в Sentry — для API, воркера и планировщика Celery.

Включается переменной SENTRY_DSN в .env (docker-compose.prod.yml передаёт её
backend, worker и beat). Без неё init_sentry ничего не делает.

Раньше инициализация была только в main.py, а сама переменная в
docker-compose.prod.yml не передавалась: включить Sentry на VPS было нельзя,
а ошибки фоновых задач (письма, уборка, снятие PRO) не попали бы туда и после
включения — воркер и beat его не инициализировали.

Персональные данные не отправляем: Sentry — сервис за рубежом, и передача
ему ПДн — трансграничная передача (152-ФЗ). Поэтому:
- send_default_pii=False — без IP, cookies, заголовков (включая
  Authorization) и данных пользователя;
- max_request_body_size="never" — без тел запросов. Это отдельная настройка:
  send_default_pii тела не выключает, а в них паспортные данные, реквизиты
  для выплат, переписка;
- include_local_variables=False — без значений переменных из стека: там те
  же данные, только уже разобранные;
- строки журнала не уходят «хлебными крошками» (в них IP-адреса и почта),
  а ошибки из журнала (logger.error) уходят событиями — ради них мониторинг
  и нужен.

Остальное SDK отправляет при любых настройках — это вычищает _scrub_event
перед отправкой:
- значения в строке запроса: /auth/refresh?refresh_token=…, /ws/…?token=…,
  код OAuth ЮMoney — остаются только имена параметров;
- аргументы задачи Celery: у писем это адрес, текст и ссылка сброса пароля
  с токеном, а задача писем падает чаще всех (SMTP недоступен);
- почта и токены в тексте ошибок и журнала («Failed to send email to …»),
  параметры SQL в тексте ошибок SQLAlchemy ([parameters: …], Key (…)=(…)).
Для разбора хватает стека, адреса запроса и user_id, если передать его явно:
sentry_sdk.set_user({"id": ...}).
"""
import logging
import re

from app.core.config import settings
from app.core.logging import logger

_initialized_for = None

FILTERED = "[Filtered]"
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_JWT = re.compile(r"\beyJ[\w-]+\.[\w-]+\.[\w-]+")
_SECRET_PARAM = re.compile(r"((?:token|code|secret|password|key)=)[^&\s'\"]+", re.IGNORECASE)
# SQLAlchemy дописывает к тексту ошибки значения параметров запроса, Postgres —
# значение, нарушившее уникальность: Key (email)=(ivan@example.com).
_SQL_PARAMS = re.compile(r"\[parameters: .*?(?=\s*\(Background on this error|\Z)", re.DOTALL)
_SQL_KEY = re.compile(r"(Key \([^)]*\)=\().*?(\) already exists|\) is not present)")


def _scrub_text(text):
    """Почту, JWT, значения token=/code=/… и параметры SQL — на заглушки."""
    if not isinstance(text, str):
        return text
    text = _SQL_PARAMS.sub(f"[parameters: {FILTERED}]", text)
    text = _SQL_KEY.sub(rf"\1{FILTERED}\2", text)
    text = _EMAIL.sub("[email]", text)
    text = _JWT.sub("[jwt]", text)
    return _SECRET_PARAM.sub(rf"\1{FILTERED}", text)


def _query_names_only(query):
    """token=abc&page=2 -> token=[Filtered]&page=[Filtered]."""
    if not query:
        return query
    names = (part.split("=", 1)[0][:64] for part in str(query).split("&"))
    return "&".join(f"{name}={FILTERED}" for name in names if name)


def _without_query(url):
    return url.split("?", 1)[0] if isinstance(url, str) else url


def _scrub_breadcrumb(crumb, hint=None):
    if not isinstance(crumb, dict):
        return crumb
    if "message" in crumb:
        crumb["message"] = _scrub_text(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        if data.get("http.query"):
            data["http.query"] = _query_names_only(data["http.query"])
        if "url" in data:
            data["url"] = _without_query(data["url"])
    return crumb


def _scrub_event(event, hint=None):
    """before_send и before_send_transaction: последний рубеж перед отправкой."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        if request.get("query_string"):
            request["query_string"] = _query_names_only(request["query_string"])
        if "url" in request:
            request["url"] = _without_query(request["url"])

    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}

    extra = event.get("extra")
    if isinstance(extra, dict):
        for key, value in list(extra.items()):
            if key == "celery-job" and isinstance(value, dict):
                for field in ("args", "kwargs"):
                    if field in value:
                        value[field] = FILTERED
            elif isinstance(value, str):
                extra[key] = _scrub_text(value)

    if "message" in event:
        event["message"] = _scrub_text(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if key in logentry:
                logentry[key] = _scrub_text(logentry[key])
        if logentry.get("params"):
            logentry["params"] = [
                p if isinstance(p, (int, float, bool)) else _scrub_text(p) if isinstance(p, str) else FILTERED
                for p in logentry["params"]
            ]

    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc, dict) and "value" in exc:
            exc["value"] = _scrub_text(exc["value"])

    crumbs = event.get("breadcrumbs")
    for crumb in (crumbs.get("values") if isinstance(crumbs, dict) else crumbs) or []:
        _scrub_breadcrumb(crumb)

    for span in event.get("spans") or []:
        data = span.get("data") if isinstance(span, dict) else None
        if isinstance(data, dict) and data.get("http.query"):
            data["http.query"] = _query_names_only(data["http.query"])
    return event


def init_sentry(component: str) -> bool:
    """Подключает Sentry один раз на процесс. True — если подключён.

    component — backend, worker или beat: тег у каждого события, чтобы
    в Sentry было видно, где произошла ошибка.
    """
    global _initialized_for
    if not settings.SENTRY_DSN:
        return False
    if _initialized_for is not None:
        return True

    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    integrations = [
        LoggingIntegration(level=None, event_level=logging.ERROR),
        SqlalchemyIntegration(),
    ]
    if component == "backend":
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        integrations.append(FastApiIntegration())
    else:
        from sentry_sdk.integrations.celery import CeleryIntegration
        integrations.append(CeleryIntegration())

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        integrations=integrations,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=_scrub_event,
        before_send_transaction=_scrub_event,
        before_breadcrumb=_scrub_breadcrumb,
    )
    sentry_sdk.get_global_scope().set_tag("component", component)
    _initialized_for = component
    logger.info(
        f"Sentry initialized | component={component} | environment={settings.SENTRY_ENVIRONMENT} "
        f"| traces_sample_rate={settings.SENTRY_TRACES_SAMPLE_RATE}"
    )
    return True
