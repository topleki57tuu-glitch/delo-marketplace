#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Переснимает только проблемные скриншоты 07 и 09:
  07_task_page.png   — карточка задания (вид заказчика)
  09_responses.png   — список откликов на том же задании (скролл вниз)
"""
import asyncio, json, urllib.request, os

BASE = "http://localhost:3000"
OUT  = os.path.join(os.path.dirname(__file__), "docs", "manual_shots")

CUST_EMAIL = "anna@delo.ru"
CUST_PASS  = "demo123"
SPEC_EMAIL = "igor@delo.ru"
SPEC_PASS  = "demo123"


def get_token_and_user(email, password):
    data = f"username={email}&password={password}".encode()
    req  = urllib.request.Request("http://localhost:8000/login", data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
    token = resp["access_token"]
    req2  = urllib.request.Request("http://localhost:8000/users/me",
                                   headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req2, timeout=15) as r:
        user = json.loads(r.read())
    return token, user


async def set_auth(page, token, user, role):
    state = json.dumps({
        "state": {"token": token, "role": role, "user": user, "isAuth": True},
        "version": 0
    })
    await page.evaluate(f"localStorage.setItem('auth', {json.dumps(state)})")


async def main():
    from playwright.async_api import async_playwright

    # Получаем токены заранее (синхронно)
    cust_token, cust_user = get_token_and_user(CUST_EMAIL, CUST_PASS)
    print("Токены получены.")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage", "--disable-gpu"]
        )

        # ------------------------------------------------------------------ #
        # 07. Карточка задания (заказчик Анна смотрит задание 2 — open)
        # ------------------------------------------------------------------ #
        print("07_task_page.png …")
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        # Сначала открываем главную, чтобы установить localStorage в нужном origin
        await page.goto(BASE, wait_until="domcontentloaded", timeout=20000)
        await set_auth(page, cust_token, cust_user, "customer")
        # Переходим на задание 2 (open, 1 отклик)
        await page.goto(BASE + "/tasks/2", wait_until="domcontentloaded", timeout=20000)
        # Ждём пока React отрендерит заголовок задания (не JSON)
        try:
            await page.wait_for_selector("h1, h2, .task-title, [class*='text-2xl'], [class*='text-3xl']",
                                         timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)
        path07 = os.path.join(OUT, "07_task_page.png")
        await page.screenshot(path=path07, full_page=False)
        print(f"  saved 07_task_page.png ({os.path.getsize(path07) // 1024} KB)")
        await page.close()

        # ------------------------------------------------------------------ #
        # 09. Список откликов (заказчик, то же задание, скролл к секции)
        # ------------------------------------------------------------------ #
        print("09_responses.png …")
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        await page.goto(BASE, wait_until="domcontentloaded", timeout=20000)
        await set_auth(page, cust_token, cust_user, "customer")
        await page.goto(BASE + "/tasks/2", wait_until="domcontentloaded", timeout=20000)
        # Ждём отрисовки блока откликов
        try:
            await page.wait_for_selector(
                "text=Отклики специалистов", timeout=12000
            )
        except Exception as e:
            print(f"  (selector timeout: {e})")
        await page.wait_for_timeout(1500)

        # Скроллим к заголовку "Отклики специалистов"
        await page.evaluate("""
            () => {
                const els = [...document.querySelectorAll('h3, span')];
                const target = els.find(el => el.textContent.includes('Отклики специалистов'));
                if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
        """)
        await page.wait_for_timeout(700)

        path09 = os.path.join(OUT, "09_responses.png")
        await page.screenshot(path=path09, full_page=False)
        print(f"  saved 09_responses.png ({os.path.getsize(path09) // 1024} KB)")
        await page.close()

        await browser.close()

    print("\n✅ Скриншоты 07 и 09 пересняты.")

    # Быстрая проверка — хеши не должны совпасть
    import hashlib
    def md5(p):
        with open(p, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    h07 = md5(path07)
    h09 = md5(path09)
    print(f"  md5(07) = {h07}")
    print(f"  md5(09) = {h09}")
    if h07 == h09:
        print("  ⚠️  Хеши совпадают — скрипт снял один и тот же кадр!")
    else:
        print("  ✅ Кадры различаются.")


if __name__ == "__main__":
    asyncio.run(main())
