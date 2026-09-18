#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Автоматизированный скриншотер для руководства пользователя «ДЕЛО».

Делает 13 скриншотов для docs/manual_shots/:
  00_brand.jpg (логотип — пропускаем, уже есть)
  01_main.png — главная страница
  02_mobile_main.png — мобильная главная
  03_auth_login.png — форма входа
  04_auth_register.png — форма регистрации
  05_create_task.png — создание задания
  06_feed.png — лента заданий
  07_task_page.png — карточка задания
  08_respond.png — форма отклика (от специалиста)
  09_responses.png — список откликов (от заказчика)
  10_chat.png — страница чатов
  11_profile.png — профиль специалиста (свой)
  12_public_profile.png — публичный профиль специалиста
  14_review.png — модалка отзыва (через force=True)
"""
import asyncio
import json
import os
import sys
import time

from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
OUT  = os.path.join(os.path.dirname(__file__), "docs", "manual_shots")
os.makedirs(OUT, exist_ok=True)

# Демо-аккаунты. Пароль резолвится из DEMO_PASSWORD или backend/demo_password.txt
# (см. scripts/_demo_env.py) — хардкода в репозитории нет.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _demo_env import DEMO_PASSWORD  # noqa: E402

CUST_EMAIL = "anna@delo.ru"
SPEC_EMAIL = "igor@delo.ru"
CUST_PASS  = DEMO_PASSWORD
SPEC_PASS  = DEMO_PASSWORD


async def screenshot(page, filename, **kwargs):
    path = os.path.join(OUT, filename)
    await page.screenshot(path=path, **kwargs)
    size = os.path.getsize(path)
    print(f"  saved {filename} ({size // 1024} KB)")


async def login_as(page, email, password):
    """Логинимся через API и записываем токен в localStorage."""
    import urllib.request, urllib.parse
    data = urllib.parse.urlencode({"username": email, "password": password}).encode()
    req  = urllib.request.Request("http://localhost:8000/login", data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
    token = resp["access_token"]
    role  = resp["role"]

    # Записываем в zustand-хранилище (persist middleware → localStorage key "auth")
    # Также fetch /users/me чтобы получить user-объект
    import urllib.request as ur
    req2 = ur.Request("http://localhost:8000/users/me",
                      headers={"Authorization": f"Bearer {token}"})
    with ur.urlopen(req2, timeout=15) as r:
        user_obj = json.loads(r.read())

    auth_state = json.dumps({
        "state": {
            "token": token,
            "role": role,
            "user": user_obj,
            "isAuth": True
        },
        "version": 0
    })
    await page.evaluate(f"localStorage.setItem('auth', {json.dumps(auth_state)})")
    return token, user_obj


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox", "--disable-setuid-sandbox",
                "--disable-dev-shm-usage", "--disable-gpu",
                "--font-render-hinting=none"
            ]
        )

        # ------------------------------------------------------------------ #
        # 1. Главная страница (desktop)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("01_main.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1500)
        await screenshot(page, "01_main.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 2. Мобильная главная
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 390, "height": 844}, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")
        print("02_mobile_main.png …")
        await page.goto(BASE + "/tasks", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1500)
        await screenshot(page, "02_mobile_main.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 3. Форма входа
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("03_auth_login.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=30000)
        # Нажимаем «Вход»
        await page.click("text=Вход")
        await page.wait_for_timeout(800)
        await screenshot(page, "03_auth_login.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 4. Форма регистрации
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("04_auth_register.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=30000)
        await page.click("text=Регистрация")
        await page.wait_for_timeout(800)
        await screenshot(page, "04_auth_register.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 5. Лента заданий (без авторизации — нейтральный вид)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("06_feed.png …")
        await page.goto(BASE + "/tasks", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)
        await screenshot(page, "06_feed.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 6. Создание задания (нужна авторизация заказчика)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("05_create_task.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, CUST_EMAIL, CUST_PASS)
        await page.goto(BASE + "/create-task", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        # Заполняем форму для красивого скриншота
        await page.fill("input[type=text][placeholder*='лендинг']", "Создать логотип и фирменный стиль для кофейни «Краса»")
        await page.fill("textarea", "Нужны логотип, палитра и шаблоны для стаканов. Тёплый крафтовый стиль, 3 концепта на выбор.")
        await page.fill("input[type=number][placeholder*='Оставьте']", "8000")
        await screenshot(page, "05_create_task.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 7. Страница задания (task #1 — крупный заказ)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("07_task_page.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, CUST_EMAIL, CUST_PASS)
        await page.goto(BASE + "/tasks/1", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        await screenshot(page, "07_task_page.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 8. Форма отклика (специалист смотрит открытое задание)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("08_respond.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, SPEC_EMAIL, SPEC_PASS)
        # Задание 2 — открытое, заказчик anna
        await page.goto(BASE + "/tasks/2", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        # Заполняем форму отклика для красивого скриншота
        try:
            textarea = page.locator("textarea").last
            await textarea.fill("Специализируюсь на айдентике для кофеен. Сделаю 3 концепта логотипа + гайдлайн (15 страниц).")
            price_input = page.locator("input[type=number]").first
            await price_input.fill("2800")
            days_input = page.locator("input[type=number]").nth(1)
            await days_input.fill("1")
        except Exception as e:
            print(f"    (форма отклика не заполнена: {e})")
        await screenshot(page, "08_respond.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 9. Список откликов (заказчик смотрит своё задание)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("09_responses.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, CUST_EMAIL, CUST_PASS)
        # task/1 у Анны есть 1 отклик
        await page.goto(BASE + "/tasks/1", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(2000)
        # Скроллим к откликам
        await page.evaluate("window.scrollTo(0, 600)")
        await page.wait_for_timeout(500)
        await screenshot(page, "09_responses.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 10. Чат (страница /chats — заказчик, у которого есть сделка в работе)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("10_chat.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        # task 12 (в работе) принадлежит Dmitry
        import json, urllib.request as _ur, urllib.parse
        req = _ur.Request("http://localhost:8000/login",
                          data=urllib.parse.urlencode(
                              {"username": "dmitry@delo.ru", "password": CUST_PASS}
                          ).encode())
        with _ur.urlopen(req, timeout=10) as r:
            dtok = json.loads(r.read())["access_token"]
        req2 = _ur.Request("http://localhost:8000/users/me",
                            headers={"Authorization": f"Bearer {dtok}"})
        with _ur.urlopen(req2, timeout=10) as r:
            duser = json.loads(r.read())
        auth_state = json.dumps({"state": {"token": dtok, "role": "customer", "user": duser, "isAuth": True}, "version": 0})
        await page.evaluate(f"localStorage.setItem('auth', {json.dumps(auth_state)})")
        await page.goto(BASE + "/chats?taskId=12", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)
        await screenshot(page, "10_chat.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 11. Профиль специалиста (свой)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("11_profile.png …")
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, SPEC_EMAIL, SPEC_PASS)
        await page.goto(BASE + "/profile", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        await screenshot(page, "11_profile.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 12. Публичный профиль специалиста (igor, id=4)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("12_public_profile.png …")
        await page.goto(BASE + "/specialist/4", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        await screenshot(page, "12_public_profile.png", full_page=False)
        await page.close()

        # ------------------------------------------------------------------ #
        # 14. Модалка отзыва (показываем через JS после завершения)
        # ------------------------------------------------------------------ #
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        print("14_review.png …")
        # Открываем завершённое задание (t10 или t11)
        await page.goto(BASE, wait_until="networkidle", timeout=15000)
        await login_as(page, CUST_EMAIL, CUST_PASS)
        await page.goto(BASE + "/tasks/10", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(1500)
        # Форсируем открытие ReviewModal через React DevTools или прямым рендером
        # Инжектируем кнопку и кликаем по ней, чтобы показать модалку
        # Т.к. задание уже завершено, кнопка «Оставить отзыв» не показывается
        # — подходим через dispatch custom event или изменяем DOM напрямую:
        await page.evaluate("""
            () => {
                // Создаём и показываем модалку для скриншота
                const modal = document.createElement('div');
                modal.id = 'demo-review-modal';
                modal.style.cssText = `
                    position:fixed; inset:0; z-index:9999;
                    background:rgba(15,23,42,0.65); backdrop-filter:blur(4px);
                    display:flex; align-items:center; justify-content:center;
                    padding:16px;
                `;
                modal.innerHTML = `
                    <div style="background:#1a2332; border:1px solid #2a3648; border-radius:24px;
                                padding:32px; max-width:480px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                        <h3 style="font-size:1.25rem; font-weight:800; color:#e8ecf4; margin:0 0 8px 0;
                                   font-family:'Unbounded',sans-serif; text-transform:uppercase; font-size:1rem;">
                            Оставить отзыв о работе
                        </h3>
                        <p style="font-size:0.75rem; color:#8b95a7; margin:0 0 20px 0;">
                            Поставьте оценку и поделитесь впечатлениями о сотрудничестве.
                        </p>
                        <div style="display:flex; gap:10px; justify-content:center; margin-bottom:20px; font-size:2rem;">
                            <span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span>
                        </div>
                        <textarea style="width:100%; padding:12px; background:#0f172a;
                                         border:1px solid #2a3648; border-radius:12px; color:#e8ecf4;
                                         font-size:0.875rem; font-family:inherit; resize:none; box-sizing:border-box;"
                                   rows="3" placeholder="Напишите комментарий...">Сделал всё в срок, общение приятное. Отдельно хочу отметить внимание к деталям — изменения вносил в тот же день.</textarea>
                        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
                            <button style="padding:8px 16px; color:#8b95a7; background:none; border:none; cursor:pointer; font-size:0.875rem;">Позже</button>
                            <button style="padding:10px 24px; background:linear-gradient(135deg,#7c6cff,#9d8dff);
                                           color:#fff; font-weight:800; border:none; border-radius:12px;
                                           cursor:pointer; font-size:0.875rem; box-shadow:0 4px 12px rgba(124,108,255,0.4);">
                                Отправить отзыв
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
        """)
        await page.wait_for_timeout(500)
        await screenshot(page, "14_review.png", full_page=False)
        await page.close()

        await browser.close()
        print("\n✅ Все скриншоты сохранены в docs/manual_shots/")


if __name__ == "__main__":
    asyncio.run(main())
