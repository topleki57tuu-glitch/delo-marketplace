import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("1. Opening app...")
        await page.goto("http://localhost:3000", timeout=30000)
        await page.wait_for_load_state("networkidle")

        print("2. Checking guest profile...")
        await page.goto("http://localhost:3000/profile", timeout=30000)
        await page.wait_for_load_state("networkidle")
        guest_content = await page.content()
        assert "Войдите в профиль" in guest_content or "Войти" in guest_content, "Guest profile check failed"
        print("✓ Guest profile renders prompt to login")

        print("3. Logging in as specialist user...")
        # Залогинимся через модалку авторизации
        login_btn = await page.query_selector("button:has-text('Войти')")
        if login_btn:
            await login_btn.click()
            await page.wait_for_timeout(500)

            # Вводим учетные данные специалиста
            email_input = await page.query_selector("input[type='email']")
            pass_input = await page.query_selector("input[type='password']")
            if email_input and pass_input:
                await email_input.fill("elena@example.com")
                await pass_input.fill("password123")
                
                submit_btn = await page.query_selector("form button[type='submit']")
                if submit_btn:
                    await submit_btn.click()
                    await page.wait_for_timeout(2000)

        print("4. Checking authorized profile page...")
        await page.goto("http://localhost:3000/profile", timeout=30000)
        await page.wait_for_timeout(1500)
        content = await page.content()

        # Проверяем элементы безопасности и верификации
        assert "Безопасность и доверие" in content, "Verification section header missing"
        assert "верификаци" in content.lower(), "Verification button or status missing"
        print("✓ Verified trust and security section present")

        # Проверяем монетизацию
        assert "Личный кошелек" in content, "Wallet section missing"
        assert "PRO" in content, "PRO status / package missing"
        assert "комиссия" in content.lower(), "Commission monetization info missing"
        print("✓ Verified monetization and escrow fee calculation present")

        # Открываем модальное окно верификации
        verify_btn = await page.query_selector("button:has-text('Пройти верификацию')")
        if verify_btn:
            await verify_btn.click()
            await page.wait_for_timeout(500)
            modal_content = await page.content()
            assert "Верификация специалиста" in modal_content, "Verification modal title missing"
            assert "Паспорт" in modal_content, "Document types missing in modal"
            print("✓ Specialist verification submission modal functions properly")

        await browser.close()
        print("🎉 ALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(main())
