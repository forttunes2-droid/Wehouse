"""Real booking presentation at phone, tablet and desktop sizes with isolated API responses."""
import asyncio
import json
from pathlib import Path
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
            stage = page.locator('[aria-label="Booking filters"]').nth(0)
            kinds = stage
            await expect(kinds.locator('button[aria-label="All"]').first).to_have_attribute('aria-pressed', 'true')
            Path('test-results/experience').mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=f'test-results/experience/bookings-default-{width}.png', full_page=True)
            await stage.locator('button[aria-label="Upcoming"]').click()
            await expect(stage.locator('button[aria-label="Upcoming"]').first).to_have_attribute('aria-pressed', 'true')
            await kinds.get_by_role('button', name='Hotel').click()
            await expect(kinds.get_by_role('button', name='Hotel')).to_have_attribute('aria-pressed', 'true')
            for button in await kinds.get_by_role('button').all():
                bounds = await button.bounding_box()
                assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1, f'clipped booking filter at {width}px: {bounds}'
            await page.screenshot(path=f'test-results/experience/bookings-filtered-{width}.png', full_page=True)
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'horizontal page overflow at {width}px'
            await page.goto(f'{BASE}/tests/browser/experience.html?fixture=booking-cards')
            await expect(page.get_by_role('button', name='Open Short Let booking for Palm Court Apartment')).to_be_visible()
            await expect(page.get_by_role('button', name='Open Hotel booking for Garden Lodge')).to_be_visible()
            await expect(page.get_by_role('button', name='Open WeHouse Service booking for Electrical repair')).to_be_visible()
            await page.get_by_role('button', name='Open Hotel booking for Garden Lodge').click()
            assert await page.evaluate('window.__bookingCardOpen') == 'hotel'
            await page.screenshot(path=f'test-results/experience/booking-cards-{width}.png', full_page=True)
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'booking card overflow at {width}px'
            await page.add_init_script("window.__nestedEvents=[];window.addEventListener('wehouse:nested-screen',event=>window.__nestedEvents.push(event.detail.open))")
            await page.goto(f'{BASE}/tests/browser/experience.html?fixture=inbox-activity')
            await expect(page.get_by_role('heading', name='Inbox', exact=True)).to_be_visible()
            await page.get_by_role('button', name='Open Activity').click()
            await expect(page.get_by_role('heading', name='Activity', exact=True)).to_be_visible()
            assert await page.evaluate('window.__nestedEvents.at(-1)') is True, 'nested Activity did not hide app navigation'
            await page.get_by_role('button', name='Back to Inbox').click()
            await expect(page.get_by_role('heading', name='Inbox', exact=True)).to_be_visible()
            assert await page.evaluate('window.__nestedEvents.at(-1)') is False, 'Inbox navigation did not return'
            assert not errors, errors
            print(f'PASS bookings layout {width}px')
            await context.close()
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
