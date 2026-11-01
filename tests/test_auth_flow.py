#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Комплексный тест входа и регистрации:
  1. Регистрация нового заказчика (валидный кейс)
  2. Регистрация нового исполнителя + switch-role (роль от клиента не принимается)
  3. Вход в систему (успешный кейс, проверка JWT и роли)
  4. Проверка получения профиля /users/me с токеном
  5. Проверка отрицательных кейсов:
     - неверный пароль -> 401
     - несуществующий email -> 401
     - дубликат email при регистрации -> 400
     - слишком короткий пароль (<6 символов) -> 422
     - некорректный email -> 422
     - регистрация без согласия на обработку ПДн -> 400
  6. Проверка восстановления пароля (forgot-password)

Работает и при выключенном, и при включённом CSRF (CSRF_ENABLED=1):
все state-changing запросы идут через Session из tests/_helpers.py,
которая сама подставляет заголовок X-CSRF-Token.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import Session  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://localhost:8000")
TS = int(time.time())


def test_auth():
    print("=== Комплексное тестирование входа и регистрации ===")

    s = Session(BASE)

    # 1. Валидная регистрация заказчика
    c_email = f"auth.test.cust.{TS}@delo-test.ru"
    c_pass = "SecurePass123"
    r1 = s.post(
        "/register/",
        json={"email": c_email, "password": c_pass, "name": "Иван Тестов", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.100.{TS % 250}"},
    )
    assert r1.status_code == 200, f"Ошибка регистрации: {r1.status_code} {r1.text}"
    user_id = r1.json()["user_id"]
    print(f"  [OK] 1. Регистрация заказчика: {c_email} (user_id={user_id})")

    # 2. Успешный вход в аккаунт
    r2 = s.post(
        "/login",
        data={"username": c_email, "password": c_pass},
        headers={"X-Forwarded-For": f"198.51.100.{TS % 250}"},
    )
    assert r2.status_code == 200, f"Ошибка логина: {r2.status_code} {r2.text}"
    login_data = r2.json()
    assert "access_token" in login_data
    assert login_data["role"] == "customer"
    token = login_data["access_token"]
    print("  [OK] 2. Вход в систему: JWT токен получен, роль корректна (customer)")

    # 3. Доступ к защищенному эндпоинту /users/me
    r3 = s.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    me = r3.json()
    assert me["email"] == c_email
    assert me["name"] == "Иван Тестов"
    assert me["role"] == "customer"
    assert "is_admin" in me, "GET /users/me должен отдавать is_admin (гейт админки)"
    assert me["is_admin"] is False, "обычный пользователь не должен быть админом"
    print("  [OK] 3. Профиль /users/me загружен: роль + is_admin с бэкенда")

    # 3.1 Согласие, данное при регистрации, записано вместе с редакцией
    #     документов: фронтенд сравнивает их и не показывает окно повторно.
    assert me.get("legal_version_required"), "GET /users/me должен отдавать действующую редакцию документов"
    assert me.get("legal_version") == me["legal_version_required"], (
        f"согласие при регистрации не записано: {me.get('legal_version')!r}"
    )
    print("  [OK] 3.1 Согласие при регистрации записано, редакция совпадает с действующей")

    # 4. Регистрация -> роль всегда customer, затем повышение до specialist.
    #    Роль при регистрации больше НЕ принимается от клиента (защита от
    #    самостоятельного назначения роли исполнителя), поэтому смена роли
    #    идёт через POST /users/me/switch-role.
    s_email = f"auth.test.spec.{TS}@delo-test.ru"
    s_pass = "SpecialistPass123"
    r4 = s.post(
        "/register/",
        json={"email": s_email, "password": s_pass, "role": "specialist", "name": "Анна Мастер", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.101.{TS % 250}"},
    )
    assert r4.status_code == 200
    r4_log = s.post(
        "/login",
        data={"username": s_email, "password": s_pass},
        headers={"X-Forwarded-For": f"198.51.101.{TS % 250}"},
    )
    assert r4_log.status_code == 200
    # Переданная при регистрации role="specialist" игнорируется сознательно:
    assert r4_log.json()["role"] == "customer", "role от клиента не должен применяться"

    cust_token = r4_log.json()["access_token"]
    r4_switch = s.post(
        "/users/me/switch-role",
        headers={"Authorization": f"Bearer {cust_token}"},
    )
    assert r4_switch.status_code == 200, f"switch-role: {r4_switch.status_code} {r4_switch.text}"
    assert r4_switch.json()["role"] == "specialist"
    spec_token = r4_switch.json()["token"]
    r4_me = s.get("/users/me", headers={"Authorization": f"Bearer {spec_token}"})
    assert r4_me.status_code == 200
    assert r4_me.json()["role"] == "specialist"
    print(f"  [OK] 4. Регистрация ({s_email}, роль=customer) + switch-role -> specialist")

    # 5. Отрицательные сценарии:
    # 5.1 Неверный пароль
    bad_pass = s.post(
        "/login",
        data={"username": c_email, "password": "WrongPassword!"},
        headers={"X-Forwarded-For": f"198.51.102.{TS % 250}"},
    )
    assert bad_pass.status_code == 401, f"Ожидался 401, получен {bad_pass.status_code}"
    print("  [OK] 5.1 Неверный пароль -> 401 (Неверный email или пароль)")

    # 5.2 Несуществующий пользователь
    no_user = s.post(
        "/login",
        data={"username": "nonexistent.user.404@test.ru", "password": "AnyPassword123"},
        headers={"X-Forwarded-For": f"198.51.103.{TS % 250}"},
    )
    assert no_user.status_code == 401
    print("  [OK] 5.2 Несуществующий пользователь -> 401")

    # 5.3 Дубликат email
    dup = s.post(
        "/register/",
        json={"email": c_email, "password": "AnotherPassword123", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.104.{TS % 250}"},
    )
    assert dup.status_code == 400
    assert "Email уже зарегистрирован" in dup.json()["detail"]
    print("  [OK] 5.3 Повторная регистрация существующего email -> 400 (Email уже зарегистрирован)")

    # 5.4 Слишком короткий пароль (<6 символов)
    short_pass = s.post(
        "/register/",
        json={"email": f"short.{TS}@test.ru", "password": "123", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.105.{TS % 250}"},
    )
    assert short_pass.status_code == 422
    print("  [OK] 5.4 Короткий пароль (< 6 символов) -> 422 валидация Pydantic")

    # 5.5 Некорректный email
    invalid_email = s.post(
        "/register/",
        json={"email": "not-an-email", "password": "ValidPassword123", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.106.{TS % 250}"},
    )
    assert invalid_email.status_code == 422
    print("  [OK] 5.5 Невалидный формат email -> 422 валидация Pydantic")

    # 5.6 Роль от клиента игнорируется (регресс на дыру с самоповышением)
    hack_email = f"auth.test.rolehack.{TS}@delo-test.ru"
    r_hack = s.post(
        "/register/",
        json={"email": hack_email, "password": "HackPass123", "role": "admin", "name": "Хакер", "accept_terms": True, "pd_consent": True},
        headers={"X-Forwarded-For": f"198.51.108.{TS % 250}"},
    )
    assert r_hack.status_code == 200
    hack_token = s.login(hack_email, "HackPass123")
    hack_me = s.get("/users/me", headers={"Authorization": f"Bearer {hack_token}"}).json()
    assert hack_me["role"] == "customer", "role=admin при регистрации не должен применяться"
    assert hack_me["is_admin"] is False, "is_admin не должен подниматься через /register"
    print("  [OK] 5.6 role=admin при регистрации проигнорирован -> customer, is_admin=false")

    # 5.7 Без согласия аккаунт не создаётся (152-ФЗ): ни без обеих отметок,
    #     ни с одной из двух. Проверяем и ответ, и что входа нет.
    for n, extra in enumerate(({}, {"accept_terms": True}, {"pd_consent": True})):
        no_consent_email = f"auth.test.noconsent{n}.{TS}@delo-test.ru"
        r_nc = s.post(
            "/register/",
            json={"email": no_consent_email, "password": "ConsentPass123", **extra},
            headers={"X-Forwarded-For": f"198.51.109.{(TS + n) % 250}"},
        )
        assert r_nc.status_code == 400, f"регистрация без согласия ({extra}): {r_nc.status_code} {r_nc.text}"
        assert "согласие" in r_nc.json()["detail"], r_nc.text
        r_nc_login = s.post(
            "/login",
            data={"username": no_consent_email, "password": "ConsentPass123"},
            headers={"X-Forwarded-For": f"198.51.109.{(TS + n) % 250}"},
        )
        assert r_nc_login.status_code == 401, "аккаунт без согласия не должен был создаться"
    print("  [OK] 5.7 Регистрация без согласия (или с одной отметкой из двух) -> 400, аккаунт не создан")

    # 5.8 Повторное согласие уже зарегистрированного пользователя
    r_lc_bad = s.post(
        "/users/me/legal-consent",
        json={"accept_terms": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r_lc_bad.status_code == 400, f"legal-consent без согласия на ПДн: {r_lc_bad.status_code}"
    r_lc = s.post(
        "/users/me/legal-consent",
        json={"accept_terms": True, "pd_consent": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r_lc.status_code == 200, f"legal-consent: {r_lc.status_code} {r_lc.text}"
    assert r_lc.json()["legal_version"] == me["legal_version_required"]
    print("  [OK] 5.8 POST /users/me/legal-consent: без отметки -> 400, с обеими -> 200")

    # 6. Запрос сброса пароля (dev_reset_link)
    forgot = s.post(
        "/auth/forgot-password",
        json={"email": c_email},
        headers={"X-Forwarded-For": f"198.51.107.{TS % 250}"},
    )
    assert forgot.status_code == 200
    assert "dev_reset_link" in forgot.json()
    print("  [OK] 6. Флоу сброса пароля: ссылка генерации нового пароля получена")

    print("\n=== ВСЕ ПРОВЕРКИ АВТОРИЗАЦИИ И РЕГИСТРАЦИИ УСПЕШНО ПРОЙДЕНЫ ===")


if __name__ == "__main__":
    test_auth()
