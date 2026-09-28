"""Real booking presentation at phone, tablet and desktop sizes with isolated API responses."""
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
                    return await request.fulfill(status=200, content_type='application/json', body=json.dumps([]), headers={'access-control-allow-origin':'*'})
                return await request.abort()
            await page.route('**/*', route)
            await page.goto(f'{BASE}/tests/browser/experience.html?fixture=bookings')
            await expect(page.get_by_role('heading', name='Bookings', exact=True)).to_be_visible()
            kind = page.get_by_role('group', name='Filter bookings by type')
            stage = page.get_by_role('group', name='Filter bookings by status')
            await expect(kind.get_by_role('button', name='All bookings')).to_have_attribute('aria-pressed', 'true')
            await stage.get_by_role('button', name='Active & upcoming').click()
            await expect(stage.get_by_role('button', name='Active & upcoming')).to_have_attribute('aria-pressed', 'true')
            await kind.get_by_role('button', name='Hotels').click()
            await expect(kind.get_by_role('button', name='Hotels')).to_have_attribute('aria-pressed', 'true')
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'horizontal page overflow at {width}px'
            assert not errors, errors
            print(f'PASS bookings layout {width}px')
            await context.close()
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
