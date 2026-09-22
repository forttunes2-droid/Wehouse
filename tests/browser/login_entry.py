"""Login layout and motion checks against the actual React test entry.
Uses the existing isolated auth/API fixtures; this does not certify live OAuth
or a physical phone's software keyboard. No production data is read or changed.
"""
import asyncio
import json
import os
from playwright.async_api import async_playwright, expect
from experience import OUT, Scenario


def password_input(page):
    # PasswordField's wrapping label includes the Show/Hide control text.
    # The stable autocomplete contract targets the input through either state.
    return page.locator('input[autocomplete="current-password"]')


async def no_overflow(page):
    dimensions = await page.evaluate('({viewport:innerWidth,content:document.documentElement.scrollWidth})')
    assert dimensions['content'] <= dimensions['viewport'] + 1, dimensions


async def run(browser):
    results = []

    async def check(name, operation):
        try:
            await operation()
            results.append({'test': name, 'passed': True})
            print('PASS', name, flush=True)
        except Exception as error:
            results.append({'test': name, 'passed': False, 'error': str(error)})
            print('FAIL', name, str(error), flush=True)
            for index, context in enumerate(browser.contexts):
                for page_index, page in enumerate(context.pages):
                    try:
                        await page.screenshot(path=str(OUT / f'login-entry-failure-{len(results)}-{index}-{page_index}.png'), full_page=True)
                    except Exception:
                        pass
        finally:
            for context in list(browser.contexts):
                await context.close()
            (OUT / 'login-entry-results.json').write_text(json.dumps(results, indent=2))

    async def welcome_and_forms():
        for width, height in [(320, 640), (390, 844), (760, 900), (1024, 768), (1440, 900), (844, 390)]:
            scenario = Scenario()
            context, page = await scenario.page(browser, 'login', width, height)
            await expect(page.get_by_role('heading', name='Welcome', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='Continue with Google', exact=True)).to_be_enabled()
            await no_overflow(page)
            await expect(page.locator('.wh-auth-form')).to_have_css('backdrop-filter', 'none')
            shell = await page.locator('.wh-auth-layout').bounding_box()
            brand = await page.locator('.wh-auth-header').bounding_box()
            form = await page.locator('.wh-auth-form').bounding_box()
            assert shell and shell['width'] <= 481, shell
            assert brand and form and abs(brand['x'] - form['x']) <= 2, (brand, form)
            assert form['y'] >= brand['y'] + brand['height'] - 2, (brand, form)
            await expect(page.locator('.wh-auth-form')).to_have_css('border-top-width', '0px')
            await page.wait_for_timeout(250)
            await page.screenshot(path=str(OUT / f'welcome-repaired-{width}.png'), full_page=True)
            await page.get_by_role('button', name='Sign in', exact=True).click()
            await expect(page.get_by_role('heading', name='Welcome back', exact=True)).to_be_visible()
            await page.get_by_label('Username or email', exact=True).fill('layout-check@example.invalid')
            await password_input(page).fill('Test-only-password')
            await expect(page.get_by_role('button', name='Sign in', exact=True)).to_be_enabled()
            await page.get_by_role('button', name='Show password', exact=True).click()
            await expect(password_input(page)).to_have_attribute('type', 'text')
            await page.get_by_role('button', name='Hide password', exact=True).click()
            await expect(password_input(page)).to_have_attribute('type', 'password')
            await no_overflow(page)
            await page.screenshot(path=str(OUT / f'signin-repaired-{width}.png'), full_page=True)
            await page.get_by_role('button', name='Back to welcome', exact=True).click()
            await page.get_by_role('button', name='Create account', exact=True).click()
            await expect(page.get_by_role('heading', name='Create your account', exact=True)).to_be_visible()
            await expect(page.get_by_label('Email', exact=True)).to_be_visible()
            await no_overflow(page)
            await page.screenshot(path=str(OUT / f'signup-repaired-{width}.png'), full_page=True)
            assert not scenario.errors, scenario.errors
            await context.close()
    await check('Welcome, email sign-in and signup fit phone/tablet/desktop/landscape', welcome_and_forms)

    async def short_viewport():
        scenario = Scenario()
        context, page = await scenario.page(browser, 'login', 390, 844)
        await page.get_by_role('button', name='Sign in', exact=True).click()
        await page.get_by_label('Username or email', exact=True).fill('layout-check@example.invalid')
        await password_input(page).fill('Test-only-password')
        await page.set_viewport_size({'width': 390, 'height': 360})
        await password_input(page).focus()
        submit = page.get_by_role('button', name='Sign in', exact=True)
        await submit.scroll_into_view_if_needed()
        await expect(submit).to_be_in_viewport()
        await expect(submit).to_be_enabled()
        await no_overflow(page)
        await page.screenshot(path=str(OUT / 'signin-short-viewport.png'))
        # Enlarged text must reflow rather than being clipped inside a fixed card.
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.add_style_tag(content='html { font-size: 24px !important; }')
        await no_overflow(page)
        await submit.scroll_into_view_if_needed()
        await expect(submit).to_be_in_viewport()
        await page.screenshot(path=str(OUT / 'signin-enlarged-text.png'), full_page=True)
        assert not scenario.errors, scenario.errors
        await context.close()
    await check('Short viewport and enlarged text keep sign-in reachable', short_viewport)

    async def reduced_motion():
        scenario = Scenario()
        context, page = await scenario.page(browser, 'login', reduced=True)
        await expect(page.locator('.wh-auth-brand')).to_have_css('animation-name', 'none')
        await expect(page.locator('.wh-auth-form')).to_have_css('animation-name', 'none')
        button = page.get_by_role('button', name='Sign in', exact=True)
        await button.hover()
        await page.mouse.down()
        try:
            await expect(button).to_have_css('transform', 'none')
        finally:
            await page.mouse.up()
        await expect(page.get_by_role('heading', name='Welcome back', exact=True)).to_be_visible()
        await expect(page.locator('.wh-auth-form')).to_have_css('animation-name', 'none')
        assert not scenario.errors, scenario.errors
        await context.close()
    await check('Reduced motion removes welcome, mode-change and press movement', reduced_motion)

    async def arrival_motion():
        for reduced in [False, True]:
            scenario = Scenario()
            context, page = await scenario.page(browser, 'arrival', reduced=reduced)
            shell = page.locator('.wh-auth-to-app-shell')
            await expect(shell).to_be_visible()
            await expect(shell).to_have_css('transform', 'none')
            await expect(shell).to_have_css('animation-name', 'none')
            timings = await page.locator('.wh-auth-to-app').evaluate('''root =>
                Array.from(root.querySelectorAll('*')).flatMap(element =>
                    element.getAnimations().map(animation => {
                        const timing = animation.effect.getTiming();
                        return Number(timing.duration) + Number(timing.delay);
                    }))''')
            assert all(duration <= 250 for duration in timings), timings
            if reduced:
                assert not timings, timings
            # Readiness, not an animation timer, decides when the real workspace appears.
            await page.evaluate('window.dispatchEvent(new Event("qa-auth-ready"))')
            await expect(page.get_by_role('button', name='Open workspaces')).to_be_visible()
            await expect(shell).to_have_count(0)
            await expect(page.locator('.page-transition.wh-workspace-enter')).to_have_css('animation-name', 'none')
            await expect(page.locator('[data-workspace-frame="v2"] > main')).to_have_css('transform', 'none')
            await page.wait_for_timeout(280)
            await page.screenshot(path=str(OUT / f'workspace-repaired-reduced-{reduced}.png'))
            assert not scenario.errors, scenario.errors
            await context.close()
    await check('Simulated auth readiness replaces a stable shell without stacked route motion', arrival_motion)
    assert all(result['passed'] for result in results), 'Login/entry checks failed; see login-entry-results.json'


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        options = {'args': ['--no-sandbox']}
        if os.environ.get('QA_CHROMIUM'):
            options['executable_path'] = os.environ['QA_CHROMIUM']
        browser = await playwright.chromium.launch(**options)
        try:
            await run(browser)
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
