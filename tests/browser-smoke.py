"""Optional interactive smoke test: python tests/browser-smoke.py (requires Playwright + Chromium)."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

async def main():
    async with async_playwright() as playwright:
        launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
        if Path('/usr/bin/chromium').exists():
            launch['executable_path'] = '/usr/bin/chromium'
        browser = await playwright.chromium.launch(**launch)
        page = await browser.new_page(viewport={'width':1440,'height':900}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        await page.set_content('<!doctype html><html><head></head><body><div id="app"></div><div id="toast"></div></body></html>')
        await page.evaluate("""() => {const map={};const s={getItem:k=>map[k]||null,setItem:(k,v)=>map[k]=v,removeItem:k=>delete map[k]};Object.defineProperty(window,'sessionStorage',{value:s});Object.defineProperty(window,'localStorage',{value:s})}""")
        css=(ROOT/'styles.css').read_text(encoding='utf-8')
        css=css[css.find(':root'):]  # avoid external Google Fonts in isolated test
        await page.add_style_tag(content=css)
        await page.add_script_tag(content=(ROOT/'app.js').read_text(encoding='utf-8'))
        assert await page.locator('h1').inner_text()=='Workforce Command Center'
        assert await page.locator('.stat-card').count()==4
        assert await page.locator('button[data-action="nav"][data-id="guide"]').count()==2
        await page.locator('.sidebar button[data-id="guide"]').click()
        assert await page.locator('h1').inner_text()=='How to Use Jim WFM AI'
        assert await page.locator('.guide-card').count()==6
        await page.locator('.guide-card button[data-id="agents"]').click()
        assert await page.locator('h1').inner_text()=='Live Agent Status'
        await page.locator('.sidebar button[data-id="overview"]').click()
        assert 'NaN' not in await page.locator('.hero-right').inner_text()
        await page.screenshot(path=str(ROOT/'preview.png'),full_page=True)
        await page.get_by_role('button',name='Live Agent Status').click()
        assert await page.locator('tbody tr').count()==48
        await page.locator('button[data-action="edit-agent"]').first.click()
        await page.locator('#af-status').select_option('Offline')
        await page.get_by_role('button',name='Save Record').click()
        assert 'Agent record saved locally' in await page.locator('#toast').inner_text()
        await page.get_by_role('button',name='Super Admin AI Studio').click()
        await page.locator('#change-prompt').fill('Change the colors to electric blue')
        await page.get_by_role('button',name='Generate Change Request').click()
        await page.locator('button[data-action="approve-request"]').first.click()
        await page.locator('button[data-action="apply-request"]').click()
        assert await page.locator('button[data-action="theme"][data-id="blue"]').first.get_attribute('class') != None
        assert 'applied' in (await page.locator('.request-row').first.inner_text()).lower()
        await page.get_by_role('button',name='Analytics & Reports').click()
        async with page.expect_download() as download_event:
            await page.get_by_role('button',name='Download CSV').click()
        assert (await download_event.value).suggested_filename=='jim-wfm-demo-center-report.csv'
        assert not errors, errors
        print('PASS: Dashboard, 48 synthetic agents, agent editing, supervised theme change, CSV download. No browser script errors.')
        await browser.close()

asyncio.run(main())
