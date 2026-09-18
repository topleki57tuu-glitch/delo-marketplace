import asyncio
import os
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _demo_env import DEMO_PASSWORD, WEB_BASE as WEB  # noqa: E402

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[ERROR] {err}"))

        print(f"Navigating to {WEB}...")
        await page.goto(WEB, wait_until="networkidle")

        print("Clicking Login button in header...")
        # Find 'Вход' button
        login_btn = page.locator("button:has-text('Вход')")
        if await login_btn.count() == 0:
            print("Login button not found! Page title:", await page.title())
            await page.screenshot(path="debug_page.png")
            await browser.close()
            return

        await login_btn.first.click()
        await page.wait_for_timeout(500)

        # Check if AuthModal appeared
        modal_title = page.locator("h2:has-text('Вход в аккаунт')")
        print("Modal visible:", await modal_title.is_visible())

        # Fill inputs
        email_input = page.locator("input[type='email']")
        password_input = page.locator("input[type='password']")
        await email_input.fill("anna@delo.ru")
        await password_input.fill(DEMO_PASSWORD)

        # Submit form
        submit_btn = page.locator("button[type='submit']:has-text('Войти')")
        print("Submitting login form...")
        await submit_btn.click()

        # Wait for toast or auth change
        await page.wait_for_timeout(2000)

        # Check localStorage
        token = await page.evaluate("() => localStorage.getItem('auth')")
        print("LocalStorage auth:", token)

        # Check header user avatar / name
        user_name = page.locator("span:has-text('Анна Смирнова')")
        print("User name in header visible:", await user_name.is_visible())

        await page.screenshot(path="debug_after_login.png")
        print("Console logs:")
        for log in console_logs:
            print("  ", log)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
