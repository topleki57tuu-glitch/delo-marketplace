#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Общие хелперы для e2e-тестов «ДЕЛО».

Главное здесь — CSRF. Бэкенд по умолчанию выключает CSRF в development
(``CSRF_ENABLED``), но включает в production. Тесты должны работать в обоих
режимах, поэтому сессия ниже всегда:

  1. запрашивает токен через ``GET /csrf-token`` (cookie + значение),
  2. отправляет значение в заголовке ``X-CSRF-Token`` на каждый POST/PUT/DELETE.

Если CSRF выключен — лишний заголовок безвреден. Если включён — тесты
проходят и, что важнее, реально проверяют защиту.
"""
import os

import requests

_CSRF_HEADER = "X-CSRF-Token"


class Session:
    """requests.Session с автоматической подстановкой CSRF-токена."""

    def __init__(self, base: str, timeout: int = 15):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self._s = requests.Session()
        # Локальный бэкенд: не пускаем запросы через системный HTTP(S)_PROXY,
        # иначе на 127.0.0.1 прилетает 502 от корпоративного прокси.
        self._s.trust_env = False
        self._csrf = None

    # -- CSRF ---------------------------------------------------------------
    def csrf(self, force: bool = False) -> str:
        """Возвращает актуальный CSRF-токен (запрашивает один раз)."""
        if self._csrf is None or force:
            r = self._s.get(f"{self.base}/csrf-token", timeout=self.timeout)
            if r.status_code == 200:
                self._csrf = r.json().get("csrf_token")
                # Backend пишет signed-cookie сам; для double-submit достаточно
                # того же значения в заголовке.
                if self._csrf:
                    self._s.headers[_CSRF_HEADER] = self._csrf
        return self._csrf

    def clear_csrf(self):
        """Убирает заголовок — нужен для негативных тестов CSRF."""
        self._csrf = None
        self._s.headers.pop(_CSRF_HEADER, None)

    # -- HTTP ---------------------------------------------------------------
    def get(self, path: str, **kw):
        kw.setdefault("timeout", self.timeout)
        return self._s.get(f"{self.base}{path}", **kw)

    def _write(self, method: str, path: str, **kw):
        self.csrf()  # гарантируем наличие заголовка
        kw.setdefault("timeout", self.timeout)
        return self._s.request(method, f"{self.base}{path}", **kw)

    def post(self, path: str, **kw):
        return self._write("POST", path, **kw)

    def put(self, path: str, **kw):
        return self._write("PUT", path, **kw)

    def patch(self, path: str, **kw):
        return self._write("PATCH", path, **kw)

    def delete(self, path: str, **kw):
        return self._write("DELETE", path, **kw)

    # -- Удобные обёртки ----------------------------------------------------
    def login(self, email: str, password: str) -> str:
        """Логин -> access_token. Бросает исключение при неудаче."""
        r = self.post("/login", data={"username": email, "password": password})
        if r.status_code != 200:
            raise RuntimeError(f"login failed: {r.status_code} {r.text[:200]}")
        return r.json()["access_token"]

    def auth(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    def register(self, email: str, password: str, role: str, name: str):
        """Регистрация.

        ``role`` бэкенд больше не принимает (защита от самостоятельного
        назначения роли). Если нужна роль specialist — после регистрации
        вызываем ``POST /users/me/switch-role``.

        Возвращаем ответ регистрации (как раньше), но переключение роли
        делаем здесь же, чтобы БД-роль успела стать specialist до того,
        как вызывающий код начнёт пользоваться токеном.
        """
        r = self.post(
            "/register/",
            json={"email": email, "password": password, "name": name},
        )
        if r.status_code == 200 and role == "specialist":
            # make_specialist выдаёт НОВЫЙ токен с ролью specialist —
            # старый токен от /login всё ещё говорит role=customer.
            self.make_specialist(email, password)
        return r

    def make_specialist(self, email: str, password: str) -> str:
        """Делает пользователя исполнителем, возвращает токен с новой ролью.

        Важно: роль в JWT старого токена не меняется, поэтому вызывающий
        код обязан использовать именно возвращённый токен.

        Идемпотентна намеренно. `/users/me/switch-role` — это
        ПЕРЕКЛЮЧАТЕЛЬ, а не «сделать исполнителем»: он меняет роль на
        противоположную. Раньше функция звала его вслепую, и повторный вызов
        молча понижал пользователя обратно до заказчика. Особенно легко на
        это наступить через ``register(..., "specialist", ...)`` — он уже
        вызывает этот метод, — и тогда следующий явный вызов возвращал
        заказчика, а эндпоинты вроде верификации отвечали 403 «доступно только
        специалистам», не имея с ролью ничего общего.
        """
        tok = self.login(email, password)
        me = self.get("/users/me", headers=self.auth(tok)).json()
        if me.get("role") == "specialist":
            return tok

        sw = self.post("/users/me/switch-role", headers=self.auth(tok))
        if sw.status_code != 200:
            raise RuntimeError(f"switch-role failed: {sw.status_code} {sw.text[:200]}")
        return sw.json()["token"]


def temp_db_url(name: str) -> str:
    """DATABASE_URL для временной SQLite-базы репро-скрипта.

    Раньше в скриптах были захардкожены пути вида ``sqlite:///C:/tmp/x.db``.
    На Windows это работало, на Linux — нет: каталога ``C:/tmp`` не существует,
    а SQLite каталоги не создаёт, поэтому скрипт падал с «unable to open
    database file». Из-за этого наборы нельзя было подключить к CI, который
    гоняет ubuntu.

    Каталог берём у системы, файл удаляем: скрипты рассчитывают начать
    с пустой схемы.
    """
    import tempfile

    path = os.path.join(tempfile.gettempdir(), f"{name}.db")
    if os.path.exists(path):
        os.remove(path)
    return "sqlite:///" + path.replace("\\", "/")


# Окружение, которое самодостаточный набор задаёт себе сам.
#
# Эти наборы поднимают приложение внутри процесса (`TestClient`) и работают со
# своей временной SQLite-базой, поэтому чужие настройки им не нужны и вредны.
SELF_CONTAINED_ENV = {
    "ENV": "development",
    # Наборы этого вида не проверяют CSRF: они не умеют отправлять токен.
    # Проверка защиты — в отдельном `test_csrf_coverage.py`.
    "CSRF_ENABLED": "0",
    # Наборы создают десятки аккаунтов подряд и без этого упираются в лимит.
    "RATE_LIMIT_ENABLED": "0",
    "SECRET_KEY": "self-contained-test-secret-not-for-production",
    "CORS_ORIGINS": "http://localhost:5173",
    "FRONTEND_URL": "http://localhost:5173",
}


def isolate_env(db_name: str, **overrides) -> str:
    """Жёстко задаёт окружение самодостаточного набора, возвращает DATABASE_URL.

    Раньше наборы выставляли переменные через ``os.environ.setdefault``. В CI
    это не работает: джоба `backend` задаёт их на весь джоб, а `setdefault`
    уже установленное значение не трогает. В результате наборы падали не
    из-за дефекта, а из-за чужого окружения:

    - ``CSRF_ENABLED=1`` из джобы делал все записи набора 403, регистрация не
      проходила, и набор падал на входе с 401 — 5 наборов из 6 были красными;
    - ``DATABASE_URL`` боевой базы уводил их в общую базу вместо временной.

    Поэтому здесь присваиваем напрямую. Наборы этого вида обязаны быть
    герметичными: что бы ни лежало в окружении, результат один и тот же.
    """
    env = dict(SELF_CONTAINED_ENV)
    env["DATABASE_URL"] = temp_db_url(db_name)
    env.update(overrides)

    for key, value in env.items():
        os.environ[key] = value

    return env["DATABASE_URL"]
