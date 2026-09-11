import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("1. Opening app...")
        await page.goto("http://localhost:3000", timeout=30000)
        await page.wait_for_load_state("networkidle")

        # Проверим страницу специалистов
        print("2. Navigating to /specialists...")
        await page.goto("http://localhost:3000/specialists", timeout=30000)
        await page.wait_for_load_state("networkidle")
        content = await page.content()
        assert "Специалисты" in content or "каталог" in content.lower(), "Specialists page failed"
        print("✓ Specialists page loaded successfully")

        # Переходим в профиль
        print("3. Navigating to /profile...")
        await page.goto("http://localhost:3000/profile", timeout=30000)
        await page.wait_for_load_state("networkidle")
        profile_content = await page.content()

        # Проверяем наличие блоков безопасности и монетизации
        assert "Безопасность и доверие" in profile_content or "верификаци" in profile_content.lower(), "Verification block missing"
        print("✓ Verification and Trust block detected")

        # Проверяем монетизацию или кошелек
        assert "Личный кошелек" in profile_content or "Баланс" in profile_content, "Wallet block missing"
        print("✓ Wallet and Monetization elements present")

        await browser.close()
        print("🎉 ALL PLAYWRIGHT TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(main())
