import asyncio
import os
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _demo_env import DEMO_PASSWORD, WEB_BASE as WEB  # noqa: E402

async def run_browser_test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("1. Opening app...")
        await page.goto(WEB, timeout=30000)
        await page.wait_for_load_state("networkidle")

        # Нажимаем кнопку Вход
        print("2. Clicking login button...")
        login_btn = await page.wait_for_selector("header button:has-text('Вход')")
        await login_btn.click()
        await page.wait_for_timeout(600)

        # Заполняем логин и пароль
        print("3. Entering login credentials...")
        email_input = await page.wait_for_selector("form input[type='email']")
        pass_input = await page.wait_for_selector("form input[type='password']")
        await email_input.fill("anna@delo.ru")
        await pass_input.fill(DEMO_PASSWORD)

        submit_btn = await page.wait_for_selector("form button[type='submit']")
        await submit_btn.click()
        await page.wait_for_timeout(2000)

        # Переходим в профиль
        print("4. Opening profile...")
        await page.goto(f"{WEB}/profile", timeout=30000)
        await page.wait_for_timeout(1500)
        content = await page.content()

        assert "Безопасность и доверие" in content, "Security block not found"
        assert "Личный кошелек" in content, "Wallet block not found"
        assert "PRO" in content, "PRO status not found"
        assert "комиссия" in content.lower(), "Commission not found"
        print("✓ Security, Verification & Monetization blocks verified in browser!")

        await browser.close()
        print("🎉 PLAYWRIGHT BROWSER TEST PASSED!")

if __name__ == "__main__":
    asyncio.run(run_browser_test())
