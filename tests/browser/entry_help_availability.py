"""Actual Login without preview copy, and unavailable Help is not empty history.
UI-only environment fixture; APIs are intercepted localhost requests. No live
account, production service, OAuth round-trip or database write is performed.
"""
import asyncio
import os
import json
import re
from playwright.async_api import async_playwright, expect
from experience import BASE, OUT, Scenario

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or None, args=["--no-sandbox"])
        try:
            for width, height in [(320, 640), (390, 844), (760, 900), (1440, 900)]:
                scenario = Scenario()
                context, page = await scenario.page(browser, 'login', width, height)
                try:
                    await expect(page.get_by_role('heading', name='Welcome', exact=True)).to_be_visible()
                    await expect(page.get_by_text(re.compile('Test preview'))).to_be_visible()
                    before = await page.locator('.wh-auth-layout').bounding_box()
                    await page.goto(BASE+'/tests/browser/experience.html?fixture=login&presentation_environment=live')
                    await expect(page.get_by_role('heading', name='Welcome', exact=True)).to_be_visible()
                    await expect(page.get_by_text(re.compile('Test preview'))).to_have_count(0)
                    await expect(page.get_by_role('link', name='Open live WeHouse', exact=True)).to_have_count(0)
                    after = await page.locator('.wh-auth-layout').bounding_box()
                    assert before and after and abs(before['width']-after['width']) <= 1, (before, after)
                    assert after['width'] <= 481 and after['x'] >= 0, after
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    await expect(page.get_by_role('button', name='Continue with Google', exact=True)).to_be_enabled()
                    await page.wait_for_timeout(250)
                    await page.screenshot(path=str(OUT/f'welcome-no-preview-{width}.png'), full_page=True)
                    await page.get_by_role('button', name='Sign in', exact=True).click()
                    await expect(page.get_by_role('heading', name='Welcome back', exact=True)).to_be_visible()
                    await page.get_by_label('Username or email', exact=True).fill('qa@example.invalid')
                    await page.locator('input[autocomplete="current-password"]').fill('Test-only-password')
                    await page.wait_for_timeout(250)
                    await page.screenshot(path=str(OUT/f'signin-no-preview-{width}.png'), full_page=True)
                    assert not scenario.errors, scenario.errors
                    results.append({'viewport': [width,height], 'passed': True, 'check': 'Actual no-preview render; unchanged bounded width', 'width': after['width']})
                    print('PASS no-preview login', width, flush=True)
                finally:
                    await context.close()

            scenario = Scenario()
            context = await browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
            page = await context.new_page()
            projection = {'valid': False, 'malformed': False}
            help_ready = asyncio.Event()
            page.on('pageerror', lambda error: scenario.errors.append(str(error)))
            async def route(req_route):
                if '/rest/v1/rpc/get_my_workspace_help_targets' in req_route.request.url:
                    requested_projection = projection.copy()
                    await help_ready.wait()
                    data = {'account': {'subject_type':'account','subject_id':'qa-self','label':'My account'},
                            'reservations':[{'subject_type':'long_let','subject_id':'old-attempt','context_type':'apartment_reservation','label':'Old unpaid attempt','detail':'cancelled'}]}
                    if requested_projection['valid']: data['payment_targets'] = []
                    if requested_projection['malformed']: data['reservations'] = {'invalid': 'not an array'}
                    return await req_route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
                return await scenario.route(req_route)
            await page.route('**/*', route)
            await page.goto(BASE+'/tests/browser/profile-help.html?mode=help')
            await page.get_by_role('button', name=re.compile('Payments and refunds')).click()
            await expect(page.get_by_role('status')).to_contain_text('Loading your help options')
            await expect(page.get_by_text('No payment or active payment attempt is linked to this workspace.', exact=True)).to_have_count(0)
            await expect(page.get_by_role('button', name='Message WeHouse', exact=True)).to_have_count(0)
            await page.screenshot(path=str(OUT/'help-loading-not-empty.png'))
            help_ready.set()
            await expect(page.get_by_role('alert')).to_contain_text("We couldn't load your help options.")
            await expect(page.get_by_text('No payment or active payment attempt is linked to this workspace.', exact=True)).to_have_count(0)
            await page.screenshot(path=str(OUT/'help-unavailable-not-empty.png'))
            projection['valid'] = True
            projection['malformed'] = True
            # Observe the retry response, not the previous render's alert.
            async with page.expect_response(lambda response: '/rest/v1/rpc/get_my_workspace_help_targets' in response.url) as malformed_retry:
                await page.get_by_role('button', name='Try again', exact=True).click()
            malformed_response = await malformed_retry.value
            assert isinstance((await malformed_response.json())['reservations'], dict)
            await expect(page.get_by_role('alert')).to_contain_text("We couldn't load your help options.")
            assert not scenario.errors, scenario.errors
            projection['malformed'] = False
            async with page.expect_response(lambda response: '/rest/v1/rpc/get_my_workspace_help_targets' in response.url) as valid_retry:
                await page.get_by_role('button', name='Try again', exact=True).click()
            valid_response = await valid_retry.value
            assert isinstance((await valid_response.json())['reservations'], list)
            # Retry preserves the selected topic. It must not send the person
            # back to the topic menu or require a second click to recover.
            await expect(page.get_by_role('heading', name='Payments and refunds', exact=True)).to_be_visible()
            await expect(page.get_by_role('region', name='Which payment is this about?', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name=re.compile('Payments and refunds'))).to_have_count(0)
            await expect(page.get_by_text('No payment or active payment attempt is linked to this workspace.', exact=True)).to_be_visible()
            await expect(page.locator('[data-help-target]')).to_have_count(0)
            await expect(page.get_by_role('alert')).to_have_count(0)
            await page.screenshot(path=str(OUT/'help-verified-empty-payments.png'))
            assert not scenario.errors, scenario.errors
            results.append({'passed':True, 'check':'Loading never claims empty; malformed lists remain retryable; verified empty payments remain distinct and the selected topic survives retry'})
            print('PASS Help availability and retry', flush=True)
            await context.close()
        except Exception as error:
            results.append({'passed':False,'error':str(error)})
            for i, context in enumerate(browser.contexts):
                for j, page in enumerate(context.pages):
                    await page.screenshot(path=str(OUT/f'entry-help-failure-{i}-{j}.png'),full_page=True)
            raise
        finally:
            (OUT/'entry-help-availability-results.json').write_text(json.dumps(results,indent=2))
            await browser.close()
asyncio.run(main())
