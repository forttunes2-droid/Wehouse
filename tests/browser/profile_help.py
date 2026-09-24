"""Recorded Account/profile/Help regressions using actual React components and
synthetic identities/APIs. Never visits Production or sends a real message.
"""
import asyncio
import os
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright, expect
BASE = 'http://127.0.0.1:4173'
OUT = Path('test-results/experience')
ACCOUNT = {'subject_type': 'account', 'subject_id': 'qa-self', 'label': 'My WeHouse account'}
ABANDONED = {'subject_type': 'long_let', 'subject_id': 'old-attempt', 'context_type': 'apartment_reservation', 'label': 'Old apartment attempt', 'detail': 'cancelled'}
STAY = {'subject_type': 'hotel', 'subject_id': '1', 'context_type': 'hotel_booking', 'label': 'Test Lodge', 'detail': 'confirmed', 'status': 'confirmed', 'record_date': '2026-09-22T00:00:00Z', 'record_reference': 'Record hotelstay'}
PAID_CANCELLED = {'subject_type': 'hotel', 'subject_id': '2', 'context_type': 'hotel_booking', 'label': 'Cancelled paid stay', 'detail': 'Refund requested', 'status': 'cancelled', 'record_date': '2026-09-21T00:00:00Z'}
HOTEL = {'subject_type': 'hotel', 'subject_id': '1', 'context_type': 'hotel_property', 'label': 'Test Lodge', 'detail': 'Hotel property', 'record_reference': 'Record property'}

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or None, args=["--no-sandbox"])
        try:
            for width, height in [(390, 844), (1440, 900)]:
                context = await browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
                page = await context.new_page()
                errors, calls = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                async def route(req_route):
                    req = req_route.request
                    if req.url.startswith(BASE): return await req_route.continue_()
                    if not req.url.startswith('http://127.0.0.1:54321/'): return await req_route.abort()
                    name = req.url.split('/')[-1].split('?')[0]
                    args = req.post_data_json if req.post_data else {}
                    calls.append((name, args))
                    data = []
                    if name == 'get_my_legal_status': data = {}
                    if name == 'get_my_workspace_help_targets':
                        data = {'account': ACCOUNT, 'reservations': [ABANDONED], 'hotel_bookings': [STAY], 'payment_targets': [STAY, PAID_CANCELLED]}
                        if args.get('p_workspace') == 'property_partner':
                            data = {'account': ACCOUNT, 'hotels': [HOTEL], 'partner_hotel_bookings': [STAY], 'payment_targets': [STAY, PAID_CANCELLED]}
                    await req_route.fulfill(status=200, content_type='application/json', body=json.dumps(data), headers={'access-control-allow-origin': '*'})
                await page.route('**/*', route)
                try:
                    await page.goto(BASE+'/tests/browser/profile-help.html?mode=account')
                    await expect(page.get_by_role('heading', name='Account', exact=True)).to_be_visible()
                    await expect(page.locator('header img')).to_have_count(0)
                    await expect(page.get_by_role('button', name='Preview profile photo', exact=True)).to_have_count(1)
                    await page.screenshot(path=str(OUT/f'account-one-identity-{width}.png'), full_page=True)

                    await page.goto(BASE+'/tests/browser/profile-help.html')
                    await page.get_by_role('button', name='Open discovery profile', exact=True).click()
                    profile = page.get_by_role('dialog', name='Avery Test profile', exact=True)
                    await expect(profile).to_be_visible()
                    await expect(profile.get_by_role('heading', name='Avery Test', exact=True)).to_have_count(1)
                    await expect(profile.get_by_text('WeHouse account', exact=True)).to_have_count(0)
                    await expect(profile.get_by_text('82%', exact=True)).to_be_visible()
                    await page.screenshot(path=str(OUT/f'profile-integrated-{width}.png'))
                    await profile.get_by_role('button', name='Back', exact=True).click()
                    await expect(profile).to_have_count(0)
                    await expect(page.get_by_role('button', name='Open discovery profile', exact=True)).to_be_focused()

                    await page.get_by_role('button', name='Open conversation info', exact=True).click()
                    info = page.get_by_role('dialog', name='Avery Test conversation info', exact=True)
                    await expect(info).to_be_visible()
                    await info.get_by_role('button', name='Profile', exact=True).click()
                    nested = page.get_by_role('dialog', name='Avery Test profile', exact=True)
                    await expect(nested).to_be_visible()
                    await expect(nested.get_by_text('A quiet, tidy home.', exact=True)).to_be_visible()
                    await expect(nested.get_by_text('82%', exact=True)).to_have_count(0)
                    assert await page.evaluate('document.getElementById("root").inert')
                    await page.go_back()
                    await expect(nested).to_have_count(0)
                    await expect(info).to_be_visible()
                    await page.go_back()
                    await expect(info).to_have_count(0)
                    assert await page.evaluate('history.state.page') == 'conversation'
                    assert await page.evaluate('history.state.workspace') == 'personal'
                    assert not await page.evaluate('document.getElementById("root").inert')
                    await expect(page.get_by_role('button', name='Open conversation info', exact=True)).to_be_focused()

                    await page.goto(BASE+'/tests/browser/profile-help.html?mode=help')
                    await page.get_by_role('button', name=re.compile('Payments and refunds')).click()
                    await expect(page.get_by_role('region',name='Which payment is this about?',exact=True)).to_be_visible()
                    await page.go_back()
                    await expect(page.get_by_role('heading',name='Help',exact=True)).to_be_visible()
                    assert not [name for name, _ in calls if name.startswith(('create_', 'send_'))], calls
                    await page.get_by_role('button', name=re.compile('Payments and refunds')).click()
                    # Typed record rows open the composer directly, without radio + submit.
                    choices = page.get_by_role('region', name='Which payment is this about?', exact=True)
                    await expect(choices).to_be_visible()
                    await expect(page.get_by_role('dialog', name='Which payment is this about?', exact=True)).to_have_count(0)
                    await expect(choices.get_by_text(re.compile('Old apartment attempt'))).to_have_count(0)
                    await expect(choices.locator('[data-help-target]')).to_have_count(2)
                    await expect(choices.get_by_role('button', name=re.compile('Cancelled paid stay.*Hotel stay.*Cancelled'))).to_be_visible()
                    await expect(page.get_by_role('button', name='Message WeHouse', exact=True)).to_have_count(0)
                    stay_choice = choices.get_by_role('button', name=re.compile('Test Lodge.*Hotel stay'))
                    assert json.loads(await stay_choice.get_attribute('data-help-target')) == ['hotel_booking', 'hotel', '1']
                    await stay_choice.click()
                    await expect(page.locator('[data-chat-composer]')).to_be_visible()
                    await expect(page.locator('header').last).to_contain_text('WeHouse')
                    await expect(page.locator('header').last).not_to_contain_text('Operations')
                    await expect(page.locator('header').last).to_contain_text('Test Lodge')
                    assert await page.evaluate('window.__lastSupportContext.contextType') == 'hotel_booking'
                    assert await page.evaluate('window.__lastSupportContext.contextSnapshot.reason_code') == 'payment_issue'
                    assert not [name for name, _ in calls if name.startswith(('create_', 'send_'))], calls
                    await page.screenshot(path=str(OUT/f'wehouse-customer-title-{width}.png'))

                    await page.goto(BASE+'/tests/browser/profile-help.html?mode=help&workspace=property_partner')
                    await page.get_by_role('button', name=re.compile('Properties and guests')).click()
                    choices = page.get_by_role('region', name='Which property or stay?', exact=True)
                    await expect(choices).to_be_visible()
                    await expect(choices.locator('[data-help-target]')).to_have_count(2)
                    # Same numeric ID/name retains different authorised destinations.
                    assert sorted(await choices.locator('[data-help-target]').evaluate_all("els => els.map(el => JSON.parse(el.dataset.helpTarget)[0])")) == ['hotel_booking', 'hotel_property']
                    await choices.get_by_role('button', name='Search your records', exact=True).click()
                    await choices.get_by_role('textbox', name='Search your records', exact=True).fill('Hotel stay')
                    await expect(choices.locator('[data-help-target]')).to_have_count(1)
                    stay_choice = choices.get_by_role('button', name=re.compile('Test Lodge.*Hotel stay'))
                    assert json.loads(await stay_choice.get_attribute('data-help-target')) == ['hotel_booking', 'hotel', '1']
                    await stay_choice.click()
                    await expect(page.locator('[data-chat-composer]')).to_be_visible()
                    assert await page.evaluate('window.__lastSupportContext.contextType') == 'hotel_booking'
                    assert not errors, errors
                    results.append({'viewport': [width, height], 'passed': True, 'checks': ['one account identity', 'one profile masthead', 'nested/native Back', 'workspace retained', 'no invented match score', 'server payment choices including paid cancellations', 'inline searchable record list', 'WeHouse recipient identity', 'hotel property/booking ID separation', 'no first-send side effect']})
                    print('PASS Account/profile/Help browser', width, flush=True)
                except Exception as error:
                    results.append({'viewport': [width, height], 'passed': False, 'error': str(error), 'page_errors': errors})
                    await page.screenshot(path=str(OUT/f'profile-help-failure-{width}.png'))
                    raise
                finally:
                    (OUT/'profile-help-results.json').write_text(json.dumps(results, indent=2))
                    await context.close()
        finally:
            await browser.close()
asyncio.run(main())
