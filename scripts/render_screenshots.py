"""Render the real plugin against synthetic notes and exercise its main interactions."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / 'docs/demo'
OUT = ROOT / 'docs/screenshots'
OUT.mkdir(exist_ok=True)

def js(value):
    return json.dumps(value, ensure_ascii=False).replace('</', '<\\/')

content = json.loads((DEMO / 'content.json').read_text())
page_html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>万卷龙鳞 · 示例笔记库</title><style>'''
page_html += (DEMO / 'base.css').read_text() + '\n' + (ROOT / 'styles.css').read_text()
page_html += '</style><body class="theme-light"><div id="home" class="dragon-scroll-home"></div><div id="settings" hidden></div><script>'
page_html += 'const DEMO_CONTENT=' + js(content) + ';const PLUGIN_SOURCE=' + js((ROOT / 'main.js').read_text()) + ';'
page_html += (DEMO / 'adapter.js').read_text() + '</script></body></html>'
preview = DEMO / 'preview.html'
preview.write_text(page_html)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1040}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(preview.as_uri())
    page.wait_for_function('window.demoReady')
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.ll-root-group').count() == 4
    assert page.locator('.ll-round-button,.ll-volume-controls').count() == 0
    assert page.evaluate('demo.view.sections.every(n=>n.depth<=2&&!n.path.startsWith("img"))')
    total = page.evaluate('demo.view.totalPages()')
    page.mouse.move(3, 3)
    page.screenshot(path=str(OUT / 'overview-light.jpg'), type='jpeg', quality=88)
    page.evaluate('document.body.className="theme-dark"')
    page.screenshot(path=str(OUT / 'overview-dark.jpg'), type='jpeg', quality=88)
    page.evaluate('document.body.className="theme-light"')
    root = page.locator('.ll-root-group[data-root-key="01 知识花园"]')
    root.get_by_role('button', name='展开子卷：实践与探索', exact=True).click()
    root.get_by_role('button', name='展开子卷：方法小集', exact=True).click()
    assert root.locator('.ll-volume[data-depth="2"]').count() == 1
    assert page.evaluate('demo.openedFiles.length') == 0
    root.screenshot(path=str(OUT / 'expanded-scroll.jpg'), type='jpeg', quality=88)
    root.get_by_role('button', name='收起子卷：实践与探索（卷名）', exact=True).click()
    assert root.locator('.ll-volume[data-depth="1"]').count() == 0
    leaf = root.locator('.ll-page').first
    leaf.hover(position={'x': 25, 'y': 45})
    assert leaf.locator('.ll-page-reveal').evaluate('(e)=>getComputedStyle(e).opacity') == '1'
    summary = leaf.locator('.ll-page-summary')
    assert summary.evaluate('(e)=>getComputedStyle(e).whiteSpace') == 'normal'
    root.screenshot(path=str(OUT / 'hover-preview.jpg'), type='jpeg', quality=88)
    leaf.click()
    assert page.evaluate('demo.openedFiles.length') == 1
    page.locator('.ll-search-input').fill('知识地图')
    assert page.locator('.ll-page').count() >= 1
    page.locator('.ll-search-input').press('Escape')
    assert page.locator('.ll-root-group:not([hidden])').count() == 4
    page.set_viewport_size({'width': 375, 'height': 812})
    assert page.locator('#home').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    page.set_viewport_size({'width': 1440, 'height': 1320})
    page.evaluate('''()=>{
      document.body.className='theme-dark';
      document.getElementById('home').hidden=true;
      document.getElementById('settings').hidden=false;
      document.querySelector('#settings details').open=true;
    }''')
    assert page.locator('.ll-directory-group').count() == 4
    page.screenshot(path=str(OUT / 'directory-settings.jpg'), type='jpeg', quality=88)
    # Real settings callback: hide a root, preserve the open disclosure, then restore it.
    setting = page.locator('.ll-directory-parent[data-folder-path="04 灵感碎片"] input')
    setting.uncheck()
    page.wait_for_function('demo.view.groups.length===3')
    assert page.evaluate('demo.plugin.savedSettings.hiddenFolders.includes("04 灵感碎片")')
    assert page.locator('#settings details').first.evaluate('(e)=>e.open')
    page.locator('.ll-directory-parent[data-folder-path="04 灵感碎片"] input').check()
    page.wait_for_function('demo.view.groups.length===4')
    assert page.evaluate('demo.view.totalPages()') == total
    assert not errors, errors
    browser.close()
print(f'Generated five screenshots from {total} synthetic notes. Interaction checks passed; no page errors.')
