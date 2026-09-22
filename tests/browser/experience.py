"""Actual React/browser interactions with test-only auth and intercepted APIs.
SQL contracts separately test authorization against disposable Supabase.
No production URL, real account, password or private message is used here.
"""
import asyncio
import json
import os
import re
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('QA_BASE_URL', 'http://127.0.0.1:4173')
OUT = Path(os.environ.get('QA_OUTPUT', 'test-results/experience'))
A, B = 'aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-2222-4222-8222-222222222222'
ACCESS = {'identity': {'user_id': 'experience-creator', 'account_kind': 'consumer', 'compatibility_role': 'creator'}, 'personal_workspace': True, 'privileged_workspaces': [{'role': 'creator', 'scope_type': 'global'}]}
ROWS = [{'conversation_id': id_, 'partner_id': f'{label}-customer', 'requester_name': label,
         'requester_role': 'property_partner', 'subject': 'Property access', 'status': 'in_progress',
         'channel_kind': 'property_operations', 'context_type': 'property_inspection',
         'context_id': id_, 'context_snapshot': {'property_title': f'{label} Home'},
         'unread_count': 1, 'last_message': f'{label} message', 'requester_state': 'Nasarawa', 'requester_lga': 'Lafia'}
        for id_, label in [(A, 'Alpha'), (B, 'Beta')]]

def bundle(id_):
    label = 'Alpha' if id_ == A else 'Beta'
    return {'conversation': {'conversation_id': id_}, 'messages': [
        {'id': f'{id_}-1', 'sender_id': f'{label}-customer', 'sender_role': 'creator', 'sender_side': 'requester', 'sender_name': label, 'content': f'{label} customer message', 'created_at': '2026-09-22T00:00:00Z', 'is_read': False, 'attachments': []},
        {'id': f'{id_}-2', 'sender_id': 'experience-creator', 'sender_role': 'user', 'sender_side': 'wehouse', 'content': f'{label} team reply', 'created_at': '2026-09-22T00:01:00Z', 'is_read': True, 'attachments': []},
    ], 'internal_notes': [{'id': f'{id_}-note', 'sender_name': 'Team member', 'content': f'{label} private work note', 'created_at': '2026-09-22T00:02:00Z', 'attachments': []}], 'events': []}

class Scenario:
    def __init__(self):
        self.delay_a = 0
        self.fail_thread = False
        self.calls = []
        self.errors = []
    async def route(self, route):
        req = route.request
        if req.url.startswith(BASE):
            return await route.continue_()
        if not req.url.startswith('http://127.0.0.1:54321/'):
            return await route.abort()
        name = req.url.split('/')[-1].split('?')[0]
        args = req.post_data_json if req.post_data else {}
        self.calls.append((name, args))
        data, status = [], 200
        if name == 'get_my_workspace_access': data = ACCESS
        elif name == 'creator_get_dashboard_summary': data = {key: 0 for key in ['accounts','partners','workers','team','apartments','hotels','hotel_team','pending_reviews','inspections','payouts']}
        elif name == 'support_inbox': data = ROWS
        elif name == 'get_operational_conversation_bundle':
            id_ = args['p_conversation_id']
            if id_ == A and self.delay_a: await asyncio.sleep(self.delay_a)
            if self.fail_thread: data, status = {'message': 'Thread temporarily unavailable', 'code': 'QA_TEST'}, 503
            else: data = bundle(id_)
        elif name == 'mark_support_messages_read': data = None
        elif 'summary' in name: data = {'unread': 0, 'needs_action': 0, 'total': 0}
        elif name == 'get_my_legal_status': data = {}
        try:
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(data), headers={'access-control-allow-origin': '*'})
        except Exception:
            if not req.is_navigation_request(): return
            raise
    async def page(self, browser, mode, width=390, height=844, seed=None, reduced=False):
        context = await browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce' if reduced else 'no-preference', service_workers='block')
        if seed:
            await context.add_init_script('for (const [k,v] of Object.entries('+json.dumps(seed)+')) localStorage.setItem(k,v);')
        page = await context.new_page()
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        await page.route('**/*', self.route)
        await page.goto(f'{BASE}/tests/browser/experience.html?fixture={mode}')
        return context, page

async def run(browser):
    results = []
    async def check(name, fn):
        try:
            await fn()
            results.append({'test': name, 'passed': True})
            print('PASS', name, flush=True)
        except Exception as error:
            results.append({'test': name, 'passed': False, 'error': str(error)})
            print('FAIL', name, str(error), flush=True)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT/'results.json').write_text(json.dumps(results, indent=2))

    async def navigation():
        s = Scenario()
        context, page = await s.page(browser, 'creator', seed={'wh_navigation_experience-creator:personal':'profile'})
        await page.get_by_role('button', name='Open workspaces').click()
        await page.get_by_role('dialog', name='Switch workspace').get_by_role('button', name=re.compile('Personal')).click()
        await expect(page).to_have_url(re.compile('#search$'))
        await expect(page.get_by_role('button', name='Explore', exact=True)).to_be_visible()
        await page.get_by_role('button', name='Account', exact=True).click()
        await expect(page).to_have_url(re.compile('#profile$'))
        await page.reload()
        await page.get_by_role('button', name='Back', exact=True).click()
        await expect(page).to_have_url(re.compile('#search$'))
        await page.screenshot(path=str(OUT/'personal-mobile.png'))
        assert not s.errors, s.errors
        await context.close()
    await check('Creator to Personal opens Explore; refreshed Account Back escapes', navigation)

    async def thread_race():
        s = Scenario(); s.delay_a = 1.6
        context, page = await s.page(browser, 'messages')
        await page.get_by_role('button', name=re.compile('Alpha')).click()
        await expect(page.get_by_label('WeHouse conversation')).to_be_visible()
        await page.get_by_role('button', name='Back to conversations').click()
        await page.get_by_role('button', name=re.compile('Beta')).click()
        await expect(page.get_by_text('Beta customer message', exact=True)).to_be_visible()
        await page.wait_for_timeout(1900)
        await expect(page.get_by_text('Alpha customer message', exact=True)).to_have_count(0)
        assert not any(name=='mark_support_messages_read' and args.get('p_conversation_id')==A for name,args in s.calls), s.calls
        assert await page.evaluate('document.activeElement.tagName') != 'TEXTAREA'
        rect = await page.get_by_label('WeHouse conversation').bounding_box()
        assert rect and rect['y'] <= 1 and rect['height'] <= 845, rect
        footer = await page.locator('[aria-label="WeHouse conversation"] footer').bounding_box()
        assert footer and footer['y']+footer['height'] <= 845, footer
        await page.screenshot(path=str(OUT/'conversation-mobile.png'))
        await page.go_back()
        await expect(page.get_by_label('WeHouse conversation')).to_have_count(0)
        await expect(page.get_by_role('button', name=re.compile('Beta'))).to_be_visible()
        assert not s.errors, s.errors
        await context.close()
    await check('Slow old thread cannot overwrite new thread or mark it read', thread_race)

    async def thread_failure():
        s=Scenario(); s.fail_thread=True
        context,page=await s.page(browser,'messages')
        await page.get_by_role('button',name=re.compile('Alpha')).click()
        await expect(page.get_by_role('alert')).to_contain_text('Thread temporarily unavailable')
        await expect(page.get_by_text('No customer messages yet.',exact=True)).to_have_count(0)
        assert not any(name=='mark_support_messages_read' for name,_ in s.calls)
        s.fail_thread=False
        await page.get_by_role('button',name='Try again',exact=True).click()
        await expect(page.get_by_text('Alpha customer message',exact=True)).to_be_visible()
        await expect(page.get_by_text('Alpha private work note',exact=True)).not_to_be_visible()
        await page.locator('summary').filter(has_text='Internal notes').click()
        await expect(page.get_by_text('Alpha private work note',exact=True)).to_be_visible()
        await page.screenshot(path=str(OUT/'internal-notes.png'))
        assert not s.errors,s.errors
        await context.close()
    await check('Failed thread shows retry, never empty success; notes remain separate',thread_failure)

    async def login_layout():
        for width,height in [(320,720),(390,844),(760,900),(1024,768),(1440,900)]:
            s=Scenario(); context,page=await s.page(browser,'login',width,height)
            await expect(page.get_by_role('heading',name='Welcome',exact=True)).to_be_visible()
            await page.wait_for_timeout(350)
            size=await page.evaluate('({width:innerWidth,body:document.documentElement.scrollWidth})')
            assert size['body']<=size['width']+1,(width,size)
            for selector in ['.wh-auth-wordmark','.wh-auth-form']:
                rect=await page.locator(selector).bounding_box()
                assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1,(width,selector,rect)
            await page.screenshot(path=str(OUT/f'login-{width}.png'))
            assert not s.errors,s.errors
            await context.close()
    await check('Welcome composition fits phone, tablet and wide desktop',login_layout)

    async def arrival():
        s=Scenario(); context,page=await s.page(browser,'arrival',reduced=True)
        await expect(page.locator('.wh-auth-to-app-shell')).to_be_visible()
        await expect(page.locator('.wh-auth-to-app-brand')).to_have_css('animation-name','none')
        await page.evaluate('window.dispatchEvent(new Event("qa-auth-ready"))')
        await expect(page.get_by_role('button',name='Open workspaces')).to_be_visible()
        await expect(page.locator('[data-workspace-frame="v2"] > main')).to_have_css('transform','none')
        await page.screenshot(path=str(OUT/'creator-reduced-motion.png'))
        assert not s.errors,s.errors
        await context.close()
    await check('Post-sign-in shell resolves without retaining transformed ancestors',arrival)
    assert all(item['passed'] for item in results), 'Browser regression checks failed; see test-results/experience/results.json'

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as playwright:
        options = {'args':['--no-sandbox']}
        if os.environ.get('QA_CHROMIUM'): options['executable_path']=os.environ['QA_CHROMIUM']
        browser=await playwright.chromium.launch(**options)
        try: await run(browser)
        finally: await browser.close()

if __name__=='__main__': asyncio.run(main())
