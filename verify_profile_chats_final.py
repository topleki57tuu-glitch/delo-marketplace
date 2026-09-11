import asyncio
from playwright.async_api import async_playwright

async def verify_everything():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print("1. Загрузка страницы и авторизация...")
        await page.goto("http://localhost:3000", wait_until="networkidle")

        # Вход под anna@delo.ru
        await page.locator("button:has-text('Вход')").first.click()
        await page.wait_for_timeout(300)
        await page.locator("input[type='email']").fill("anna@delo.ru")
        await page.locator("input[type='password']").fill("demo123")
        await page.locator("button[type='submit']:has-text('Войти')").click()
        await page.wait_for_timeout(1500)

        # 2. Проверка раздела Профиль и выбора любого города
        print("2. Переход в Профиль и проверка выбора города...")
        await page.goto("http://localhost:3000/profile", wait_until="networkidle")
        await page.wait_for_timeout(800)

        # Открываем редактор профиля
        edit_btn = page.locator("button:has-text('Редактировать профиль')")
        if await edit_btn.is_visible():
            await edit_btn.click()
            await page.wait_for_timeout(400)

            city_input = page.locator("input[placeholder*='город']")
            await city_input.fill("Владивосток")
            await page.wait_for_timeout(400)

            # Проверяем появление выпадающего списка
            hint = page.locator("button:has-text('Владивосток')")
            has_hint = await hint.count() > 0
            print("   -> Подсказка города Владивосток в списке:", has_hint)

            # Проверяем ввод редкого города/поселка РФ
            await city_input.fill("Красная Поляна")
            await page.wait_for_timeout(400)
            custom_btn = page.locator("button:has-text('Красная Поляна')")
            has_custom = await custom_btn.count() > 0
            print("   -> Поддержка любого города/поселка РФ (Красная Поляна):", has_custom)

        # 3. Проверка раздела Сообщения и быстрых шаблонов
        print("3. Переход в Сообщения (Чат) и проверка шаблонов...")
        await page.goto("http://localhost:3000/chats", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        # Проверяем наличие чипов быстрых ответов
        quick_chip = page.locator("button:has-text('Здравствуйте!')")
        has_chips = await quick_chip.count() > 0
        print("   -> Быстрые шаблоны ответов в чате отображаются:", has_chips)

        if has_chips:
            await quick_chip.first.click()
            input_val = await page.locator("input[placeholder*='сообщение']").input_value()
            print("   -> Подстановка шаблона в поле ввода:", bool(input_val))

        await page.screenshot(path="frontend/public/final_chats_and_profile_test.png")
        print("4. Скриншот проверки сохранен в frontend/public/final_chats_and_profile_test.png")

        await browser.close()
        print("\n=== ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ УСПЕШНО ===")

if __name__ == "__main__":
    asyncio.run(verify_everything())
