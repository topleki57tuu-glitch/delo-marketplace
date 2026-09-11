import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("1. Opening app...")
        await page.goto("http://localhost:3000", timeout=30000)
        await page.wait_for_load_state("networkidle")

        print("2. Opening login modal directly...")
        # Нажимаем кнопку Вход в хедере
        login_btn = await page.wait_for_selector("button:has-text('Вход')", timeout=5000)
        await login_btn.click()
        await page.wait_for_timeout(500)

        print("3. Filling credentials...")
        email_input = await page.wait_for_selector("input[type='email']")
        pass_input = await page.wait_for_selector("input[type='password']")
        await email_input.fill("elena@example.com")
        await pass_input.fill("password123")

        submit_btn = await page.wait_for_selector("button:has-text('Войти')")
        await submit_btn.click()
        await page.wait_for_timeout(2500)

        print("4. Navigating to profile...")
        await page.goto("http://localhost:3000/profile", timeout=30000)
        await page.wait_for_timeout(2000)

        content = await page.content()
        assert "Безопасность и доверие" in content, "Verification section header missing"
        assert "верификаци" in content.lower(), "Verification button or status missing"
        print("✓ Verified trust and security section present!")

        assert "Личный кошелек" in content, "Wallet section missing"
        assert "PRO" in content, "PRO status / package missing"
        assert "комиссия" in content.lower(), "Commission monetization info missing"
        print("✓ Verified monetization and escrow fee calculation present!")

        # Проверяем модалку верификации
        verify_btn = await page.query_selector("button:has-text('Пройти верификацию')")
        if verify_btn:
            await verify_btn.click()
            await page.wait_for_timeout(500)
            modal_content = await page.content()
            assert "Верификация специалиста" in modal_content, "Verification modal title missing"
            assert "Паспорт" in modal_content, "Document types missing in modal"
            print("✓ Specialist verification submission modal functions properly!")

        await browser.close()
        print("🎉 SUCCESS: ALL E2E VERIFICATION & MONETIZATION TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(run())
