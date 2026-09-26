"""Delayed-data arrival through the real App and CreatorOverview.
Uses the existing isolated browser harness; never connects to production.
"""
import asyncio
import json
import os
from playwright.async_api import async_playwright, expect
from experience import Scenario, OUT

class SlowOverview(Scenario):
    def __init__(self):
        super().__init__()
        self.ready = asyncio.Event()
    async def route(self, route):
        if route.request.url.startswith('http://127.0.0.1:54321/rest/v1/rpc/creator_get_dashboard_summary'):
            await self.ready.wait()
        await super().route(route)

async def check(browser, reduced):
    scenario = SlowOverview()
    context, page = await scenario.page(browser, 'creator', reduced=reduced)
    try:
        skeleton = page.get_by_role('status', name='Loading overview', exact=True)
        await expect(skeleton).to_be_visible()
        await expect(skeleton.locator(':scope > div')).to_have_count(6)
        await expect(page.locator('[data-overview-state="ready"]')).to_have_count(0)
        # Let the earlier workspace animation finish before releasing data.
        await page.wait_for_timeout(450)
        await page.screenshot(path=str(OUT/f'overview-loading-{reduced}.png'))
        scenario.ready.set()
        rows = page.locator('[data-overview-state="ready"] > button')
        await expect(rows).to_have_count(6)
        await expect(rows.first).to_have_css('animation-name', 'none' if reduced else 'whOverviewRowIn')
        await page.wait_for_timeout(420)
        await expect(rows.first).to_have_css('transform', 'none')
        await expect(rows.last).to_have_css('opacity', '1')
        await expect(page.locator('[data-workspace-frame="v2"] > main')).to_have_css('transform', 'none')
        await page.screenshot(path=str(OUT/f'overview-ready-{reduced}.png'))
        assert not scenario.errors, scenario.errors
    finally:
        scenario.ready.set()
        await context.close()

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as playwright:
        options = {'args': ['--no-sandbox']}
        if os.environ.get('QA_CHROMIUM'): options['executable_path'] = os.environ['QA_CHROMIUM']
        browser = await playwright.chromium.launch(**options)
        try:
            for reduced in [False, True]:
                name = f'Late overview data gets its own entrance; reduced motion={reduced}'
                try:
                    await check(browser, reduced)
                    results.append({'test': name, 'passed': True})
                    print('PASS', name, flush=True)
                except Exception as error:
                    results.append({'test': name, 'passed': False, 'error': str(error)})
                    print('FAIL', name, str(error), flush=True)
        finally:
            await browser.close()
            (OUT/'overview-arrival-results.json').write_text(json.dumps(results, indent=2))
    assert results and all(row['passed'] for row in results), 'Overview arrival browser checks failed'

if __name__ == '__main__': asyncio.run(main())
