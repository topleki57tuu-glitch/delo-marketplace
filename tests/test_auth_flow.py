#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Комплексный тест входа и регистрации:
  1. Регистрация нового заказчика (валидный кейс)
  2. Регистрация нового исполнителя (валидный кейс)
  3. Вход в систему (успешный кейс, проверка JWT и роли)
  4. Проверка получения профиля /users/me с токеном
  5. Проверка отрицательных кейсов:
     - неверный пароль -> 401
     - несуществующий email -> 401
     - дубликат email при регистрации -> 400
     - слишком короткий пароль (<6 символов) -> 422
     - некорректный email -> 422
  6. Проверка восстановления пароля (forgot-password)
"""
import time
import requests

BASE = "http://localhost:8000"
TS = int(time.time())

def test_auth():
    print("=== Комплексное тестирование входа и регистрации ===")

    # 1. Валидная регистрация заказчика
    c_email = f"auth.test.cust.{TS}@delo-test.ru"
    c_pass = "SecurePass123"
    r1 = requests.post(
        f"{BASE}/register/",
        json={"email": c_email, "password": c_pass, "role": "customer", "name": "Иван Тестов"},
        headers={"X-Forwarded-For": f"198.51.100.{TS % 250}"}
    )
    assert r1.status_code == 200, f"Ошибка регистрации: {r1.status_code} {r1.text}"
    user_id = r1.json()["user_id"]
    print(f"  [OK] 1. Регистрация заказчика: {c_email} (user_id={user_id})")

    # 2. Успешный вход в аккаунт
    r2 = requests.post(
        f"{BASE}/login",
        data={"username": c_email, "password": c_pass},
        headers={"X-Forwarded-For": f"198.51.100.{TS % 250}"}
    )
    assert r2.status_code == 200, f"Ошибка логина: {r2.status_code} {r2.text}"
    login_data = r2.json()
    assert "access_token" in login_data
    assert login_data["role"] == "customer"
    token = login_data["access_token"]
    print("  [OK] 2. Вход в систему: JWT токен получен, роль корректна (customer)")

    # 3. Доступ к защищенному эндпоинту /users/me
    r3 = requests.get(f"{BASE}/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    me = r3.json()
    assert me["email"] == c_email
    assert me["name"] == "Иван Тестов"
    assert me["role"] == "customer"
    print("  [OK] 3. Профиль пользователя (/users/me) успешно загружен через полученный токен")

    # 4. Валидная регистрация специалиста
    s_email = f"auth.test.spec.{TS}@delo-test.ru"
    s_pass = "SpecialistPass123"
    r4 = requests.post(
        f"{BASE}/register/",
        json={"email": s_email, "password": s_pass, "role": "specialist", "name": "Анна Мастер"},
        headers={"X-Forwarded-For": f"198.51.101.{TS % 250}"}
    )
    assert r4.status_code == 200
    r4_log = requests.post(
        f"{BASE}/login",
        data={"username": s_email, "password": s_pass},
        headers={"X-Forwarded-For": f"198.51.101.{TS % 250}"}
    )
    assert r4_log.status_code == 200
    assert r4_log.json()["role"] == "specialist"
    print(f"  [OK] 4. Регистрация и логин специалиста ({s_email}, роль=specialist)")

    # 5. Отрицательные сценарии:
    # 5.1 Неверный пароль
    bad_pass = requests.post(
        f"{BASE}/login",
        data={"username": c_email, "password": "WrongPassword!"},
        headers={"X-Forwarded-For": f"198.51.102.{TS % 250}"}
    )
    assert bad_pass.status_code == 401, f"Ожидался 401, получен {bad_pass.status_code}"
    print("  [OK] 5.1 Неверный пароль -> 401 (Неверный email или пароль)")

    # 5.2 Несуществующий пользователь
    no_user = requests.post(
        f"{BASE}/login",
        data={"username": "nonexistent.user.404@test.ru", "password": "AnyPassword123"},
        headers={"X-Forwarded-For": f"198.51.103.{TS % 250}"}
    )
    assert no_user.status_code == 401
    print("  [OK] 5.2 Несуществующий пользователь -> 401")

    # 5.3 Дубликат email
    dup = requests.post(
        f"{BASE}/register/",
        json={"email": c_email, "password": "AnotherPassword123", "role": "customer"},
        headers={"X-Forwarded-For": f"198.51.104.{TS % 250}"}
    )
    assert dup.status_code == 400
    assert "Email уже зарегистрирован" in dup.json()["detail"]
    print("  [OK] 5.3 Повторная регистрация существующего email -> 400 (Email уже зарегистрирован)")

    # 5.4 Слишком короткий пароль (<6 символов)
    short_pass = requests.post(
        f"{BASE}/register/",
        json={"email": f"short.{TS}@test.ru", "password": "123", "role": "customer"},
        headers={"X-Forwarded-For": f"198.51.105.{TS % 250}"}
    )
    assert short_pass.status_code == 422
    print("  [OK] 5.4 Короткий пароль (< 6 символов) -> 422 валидация Pydantic")

    # 5.5 Некорректный email
    invalid_email = requests.post(
        f"{BASE}/register/",
        json={"email": "not-an-email", "password": "ValidPassword123", "role": "customer"},
        headers={"X-Forwarded-For": f"198.51.106.{TS % 250}"}
    )
    assert invalid_email.status_code == 422
    print("  [OK] 5.5 Невалидный формат email -> 422 валидация Pydantic")

    # 6. Запрос сброса пароля (dev_reset_link)
    forgot = requests.post(
        f"{BASE}/auth/forgot-password",
        json={"email": c_email},
        headers={"X-Forwarded-For": f"198.51.107.{TS % 250}"}
    )
    assert forgot.status_code == 200
    assert "dev_reset_link" in forgot.json()
    print("  [OK] 6. Флоу сброса пароля: ссылка генерации нового пароля получена")

    print("\n=== ВСЕ ПРОВЕРКИ АВТОРИЗАЦИИ И РЕГИСТРАЦИИ УСПЕШНО ПРОЙДЕНЫ ===")

if __name__ == "__main__":
    test_auth()
