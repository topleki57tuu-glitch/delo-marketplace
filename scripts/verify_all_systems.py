import asyncio
import os
import sys

from playwright.async_api import async_playwright
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _demo_env import DEMO_PASSWORD, API_BASE as API, WEB_BASE as WEB  # noqa: E402


def _login(email):
    res = requests.post(f"{API}/login",
                        data={"username": email, "password": DEMO_PASSWORD})
    assert res.status_code == 200, f"Login failed ({email}): {res.text}"
    return res.json()["access_token"]


def test_backend_and_e2e():
    # 1. Тестируем авторизацию и подачу верификации через API
    print("--- [1] Backend Verification & Monetization API ---")
    token_spec = _login("anna@delo.ru")
    headers_spec = {"Authorization": f"Bearer {token_spec}"}

    # Подаем заявку на верификацию
    sub_res = requests.post(f"{API}/verification/submit", headers=headers_spec, json={
        "full_name": "Анна Смирнова",
        "document_type": "passport",
        "document_number": "4510 112233"
    })
    print("Submit verification status:", sub_res.status_code)

    # Проверяем статус верификации
    st_res = requests.get(f"{API}/verification/status", headers=headers_spec)
    assert st_res.status_code == 200, "Get verification status failed"
    print("Verification data:", st_res.json())

    # Модерация через админа
    token_adm = _login("admin@delo.ru")
    headers_adm = {"Authorization": f"Bearer {token_adm}"}

    adm_list = requests.get(f"{API}/verification/admin/list", headers=headers_adm)
    print("Admin verification requests found:", len(adm_list.json()))
    if adm_list.json():
        first_req = adm_list.json()[0]
        if first_req["status"] == "pending":
            rev = requests.post(f"{API}/verification/admin/{first_req['id']}/review", headers=headers_adm, json={"action": "approve"})
            print("Admin approved request:", rev.json())

    # Проверяем комиссию при завершении эскроу-заказа
    print("--- [2] Escrow Fee Calculation & Task Complete ---")
    # Создаем заказ от лица заказчика
    token_cust = _login("dmitry@delo.ru")
    headers_cust = {"Authorization": f"Bearer {token_cust}"}

    create_task_res = requests.post(f"{API}/tasks/", headers=headers_cust, json={
        "title": "Тестовый заказ с эскроу",
        "description": "Проверка комиссии платформы и безопасной сделки",
        "budget": 10000,
        "category": "development",
        "city": "Москва"
    })
    assert create_task_res.status_code == 200
    task_id = create_task_res.json()["task_id"]

    # Назначаем исполнителя напрямую в БД + снимаем открытый эскроу
    import sqlite3
    db_path = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                     "backend", "marketplace_v3.db"),
    )
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("UPDATE tasks SET executor_id = 1, status = 'in_progress' WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()

    # Завершаем заказ заказчиком
    comp_res = requests.put(f"{API}/tasks/{task_id}/complete", headers=headers_cust)
    assert comp_res.status_code == 200
    comp_data = comp_res.json()
    print("Escrow complete response:", comp_data)
    assert "released" in comp_data and "fee" in comp_data, "Fee fields missing in task completion"
    print(f"✓ Payout: {comp_data['released']} ₽, Platform Fee (5%): {comp_data['fee']} ₽")

    print("\nAll backend integration tests passed successfully!")

async def run_browser():
    print("--- [3] Playwright Headless Browser UI Test ---")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto(WEB, timeout=30000)
        await page.wait_for_load_state("networkidle")

        # Вход как специалист
        login_btn = await page.wait_for_selector("button:has-text('Вход')")
        await login_btn.click()
        await page.wait_for_timeout(400)

        await (await page.wait_for_selector("input[type='email']")).fill("anna@delo.ru")
        await (await page.wait_for_selector("input[type='password']")).fill(DEMO_PASSWORD)
        await (await page.wait_for_selector("button:has-text('Войти')")).click()
        await page.wait_for_timeout(1500)

        # Переход в профиль
        await page.goto(f"{WEB}/profile", timeout=30000)
        await page.wait_for_timeout(1000)
        content = await page.content()

        assert "Безопасность и доверие" in content, "Security & Trust section missing"
        assert "Личный кошелек" in content, "Wallet section missing"
        assert "PRO" in content, "PRO status missing"
        assert "комиссия" in content.lower(), "Commission info missing"
        print("✓ Verified profile trust, verification, and monetization UI!")

        await browser.close()
        print("🎉 All Browser & Backend Tests PASSED!")

if __name__ == "__main__":
    test_backend_and_e2e()
    asyncio.run(run_browser())
