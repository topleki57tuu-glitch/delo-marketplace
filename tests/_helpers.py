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
        """Повышает заказчика до исполнителя, возвращает новый токен.

        Важно: роль в JWT старого токена не меняется, поэтому вызывающий
        код обязан использовать именно возвращённый токен.
        """
        tok = self.login(email, password)
        sw = self.post("/users/me/switch-role", headers=self.auth(tok))
        if sw.status_code != 200:
            raise RuntimeError(f"switch-role failed: {sw.status_code} {sw.text[:200]}")
        return sw.json()["token"]
