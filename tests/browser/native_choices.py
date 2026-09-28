"""The same dark choice sheet works for dynamic, numeric and disabled controls."""
import asyncio
import json
from playwright.async_api import async_playwright, expect

BASE = 'http://127.0.0.1:4173'

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=['--no-sandbox'])
        for width in (320, 390, 768, 1440):
            context = await browser.new_context(viewport={'width': width, 'height': 844}, service_workers='block')
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            async def route(request):
                if request.request.url.startswith(BASE):
                    return await request.continue_()
                if request.request.url.startswith('http://127.0.0.1:54321/'):
                    return await request.fulfill(status=200, content_type='application/json', body=json.dumps([]), headers={'access-control-allow-origin': '*'})
                return await request.abort()
            await page.route('**/*', route)
            await page.goto(f'{BASE}/tests/browser/experience.html?fixture=choices')
            assert await page.locator('select').count() == 0
            await expect(page.get_by_role('button', name='Unavailable role')).to_be_disabled()
            await page.get_by_role('button', name='City').click()
            dialog = page.get_by_role('dialog', name='City')
            await expect(dialog).to_be_visible()
            assert await page.evaluate("document.body.style.overflow === 'hidden'")
            await dialog.get_by_role('textbox', name='Search city').fill('Keffi')
            await dialog.get_by_role('button', name='Keffi').click()
            await expect(page.get_by_role('status')).to_contain_text('Keffi · 3 days')
            assert await page.evaluate("document.body.style.overflow !== 'hidden'")
            await page.get_by_role('button', name='Duration').click()
            await page.get_by_role('dialog', name='Duration').get_by_role('button', name='7 days').click()
            await expect(page.get_by_role('status')).to_contain_text('Keffi · 7 days')
            await page.get_by_role('button', name='Duration').click()
            await page.keyboard.press('Escape')
            await expect(page.get_by_role('dialog')).to_have_count(0)
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert not errors, errors
            print(f'PASS custom choices {width}px')
            await context.close()
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
