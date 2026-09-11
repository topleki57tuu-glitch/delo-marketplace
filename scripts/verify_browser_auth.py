import asyncio
from playwright.async_api import async_playwright
import time

async def test_full_auth():
    ts = int(time.time())
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print("1. Открытие главной страницы...")
        await page.goto("http://localhost:3000", wait_until="networkidle")

        # ---------------- ТЕСТ 1: РЕГИСТРАЦИЯ ----------------
        print("2. Проверка формы РЕГИСТРАЦИИ...")
        reg_nav_btn = page.locator("button:has-text('Регистрация')")
        await reg_nav_btn.first.click()
        await page.wait_for_timeout(400)

        new_email = f"user.{ts}@delo.ru"
        new_pass = "password123"
        await page.locator("input[placeholder='Иван Иванов']").fill("Тестовый Пользователь")
        await page.locator("input[type='email']").fill(new_email)
        await page.locator("input[type='password']").fill(new_pass)

        # Нажимаем Зарегистрироваться
        submit_reg = page.locator("button[type='submit']:has-text('Зарегистрироваться')")
        await submit_reg.click()
        await page.wait_for_timeout(2000)

        # Проверяем, что в шапке появилось имя пользователя
        user_header = page.locator("span:has-text('Тестовый Пользователь')")
        is_logged_in_after_reg = await user_header.is_visible()
        print("   -> Успешная регистрация и автоматический вход:", is_logged_in_after_reg)
        assert is_logged_in_after_reg, "Не вошли после регистрации"

        # ---------------- ТЕСТ 2: ВЫХОД ----------------
        print("3. Проверка ВЫХОДА из аккаунта...")
        logout_btn = page.locator("button:has-text('Выйти')")
        await logout_btn.click()
        await page.wait_for_timeout(500)
        is_logged_out = await page.locator("button:has-text('Вход')").is_visible()
        print("   -> Выход успешен:", is_logged_out)
        assert is_logged_out, "Не удалось выйти"

        # ---------------- ТЕСТ 3: ВХОД ПОД ДЕМО-АККАУНТОМ ----------------
        print("4. Проверка ВХОДА (anna@delo.ru / demo123)...")
        await page.locator("button:has-text('Вход')").first.click()
        await page.wait_for_timeout(400)

        await page.locator("input[type='email']").fill("anna@delo.ru")
        await page.locator("input[type='password']").fill("demo123")
        await page.locator("button[type='submit']:has-text('Войти')").click()
        await page.wait_for_timeout(2000)

        anna_header = page.locator("span:has-text('Анна Смирнова')")
        is_anna_in = await anna_header.is_visible()
        print("   -> Успешный вход под демо-пользователем Анна Смирнова:", is_anna_in)
        assert is_anna_in, "Вход под anna@delo.ru не сработал"

        await page.screenshot(path="frontend/public/test_login_success.png")
        print("5. Скриншот сохранён: frontend/public/test_login_success.png")
        await browser.close()
        print("\n=== ВСЕ ТЕСТЫ UI ВХОДА И РЕГИСТРАЦИИ В БРАУЗЕРЕ УСПЕШНО ПРОШЛИ ===")

if __name__ == "__main__":
    asyncio.run(test_full_auth())
