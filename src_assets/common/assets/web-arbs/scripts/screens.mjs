// ARBS-H UI1b: screenshots of every card (light / dark), disabled states (D-UI-3), narrow width,
// and a few behaviour checks, against scripts/mock-server.mjs. Uses an installed Chrome/Edge
// (no browser download): set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
// Usage: node scripts/screens.mjs --base http://127.0.0.1:5180 --out <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const base = args.base ?? 'http://127.0.0.1:5180';
const out = resolve(args.out ?? 'screens');
mkdirSync(out, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const DEV = '11111111-2222-3333-4444-555555555555';
const APP = 'aaaa1111-0000-4000-8000-000000000002';
const results = { shots: [], checks: [], contrast: {} };

async function mock(state) {
  await fetch(`${base}/__mock/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
}
async function last() {
  return (await fetch(`${base}/__mock/last`)).json();
}
function check(name, pass, detail = '') {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const releases = [
  {
    tag_name: 'v0.2.0',
    name: 'ARBS-H 0.2.0',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/arbs-project/arbs-h/releases/tag/v0.2.0',
    body: 'mock',
    published_at: '2026-11-25T00:00:00Z',
    assets: [{ name: 'arbs-h-0.2.0-setup.exe', state: 'uploaded', size: 1000 }],
  },
];

async function context(browser, theme, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme === 'dark' ? 'dark' : 'light', locale: 'ko-KR' });
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem('arbs.theme', value);
    } catch {}
  }, theme);
  await ctx.route('https://api.github.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(releases) }),
  );
  await ctx.route(/^https:\/\/(?!api\.github\.com)/, (route) => route.abort());
  return ctx;
}

async function shot(page, name, path, prepare) {
  await page.goto(`${base}${path}`);
  await page.waitForSelector('.page, .overlay', { timeout: 15000 });
  await page.waitForTimeout(400);
  if (prepare) await prepare(page);
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.shots.push({ name, path, file: `${name}.png` });
}

function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
function parse(color) {
  return color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const cards = [
    ['S-status', '/arbs/'],
    ['D-devices', `/arbs/devices/${DEV}`],
    ['C-controller', '/arbs/controller', (p) => p.locator('details[data-advanced]').evaluate((d) => (d.open = true))],
    ['V-display', '/arbs/display'],
    ['A-apps', `/arbs/apps/${APP}`],
    ['T-troubleshoot', '/arbs/troubleshoot'],
    ['U-account', '/arbs/account'],
    [
      'X-common-savebar',
      '/arbs/controller',
      async (p) => {
        await p.selectOption('[data-setting="arbs_trigger_status"]', 'enabled');
        await p.fill('#arbs-setting-search', '트리거');
      },
    ],
  ];
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true });
    const ctx = await context(browser, theme);
    const page = await ctx.newPage();
    for (const [name, path, prepare] of cards) await shot(page, `${name}-${theme}`, path, prepare);

    // Measured colours (computed styles) for the contrast table.
    await page.goto(`${base}/arbs/account`);
    await page.waitForSelector('.page');
    const colors = await page.evaluate(() => {
      const get = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      return {
        bodyText: get('body', 'color'),
        bodyBg: get('body', 'backgroundColor'),
        cardBg: get('.card', 'backgroundColor'),
        muted: get('.muted', 'color'),
        primaryText: get('.button--primary', 'color'),
        primaryBg: get('.button--primary', 'backgroundColor'),
        link: get('.footer a', 'color'),
        navCurrent: get('.nav__link--current', 'color'),
        navCurrentBg: get('.nav__link--current', 'backgroundColor'),
        reasonText: get('.reason', 'color'),
      };
    });
    results.contrast[theme] = {
      colors,
      'body text / page': ratio(parse(colors.bodyText), parse(colors.bodyBg)),
      'muted / card': ratio(parse(colors.muted), parse(colors.cardBg)),
      'primary button text / button': ratio(parse(colors.primaryText), parse(colors.primaryBg)),
      'link / page': ratio(parse(colors.link), parse(colors.bodyBg)),
      'current menu / tint': ratio(parse(colors.navCurrent), parse(colors.navCurrentBg)),
      'reason / card': ratio(parse(colors.reasonText), parse(colors.cardBg)),
    };
    check(`${theme}: data-theme applied`, (await page.getAttribute('html', 'data-theme')) === theme);
    await ctx.close();
  }

  // Narrow (phone) width: cards in one column.
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true });
    const ctx = await context(browser, theme, { width: 390, height: 844 });
    const page = await ctx.newPage();
    await shot(page, `N-status-390-${theme}`, '/arbs/');
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length);
    check(`${theme} 390px: one card column`, columns === 1, `columns=${columns}`);
    await shot(page, `N-controller-390-${theme}`, '/arbs/controller', async (p) => {
      await p.click('.topbar__menu');
    });
    await ctx.close();
  }

  // D-UI-3 disabled behaviour (light).
  await mock({ reset: true });
  const ctx = await context(browser, 'light');
  const page = await ctx.newPage();

  await shot(page, 'R3-devices-none-selected', '/arbs/devices');
  for (const action of ['device-save', 'device-disconnect', 'device-unpair'])
    check(`R3 ${action} disabled before a device is chosen`, await page.isDisabled(`[data-action="${action}"]`));
  check('R3 reason shown', (await page.textContent('#reason-device'))?.includes('먼저 기기를 고르세요'));

  await shot(page, 'R4-device-offline', '/arbs/devices/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  check('R4 disconnect disabled for an offline device', await page.isDisabled('[data-action="device-disconnect"]'));
  check('R4 unpair enabled for a chosen device', !(await page.isDisabled('[data-action="device-unpair"]')));

  await shot(page, 'R5-apps-none-selected', '/arbs/apps');
  for (const action of ['app-launch', 'app-close', 'app-delete', 'app-save'])
    check(`R5 ${action} disabled before an app is chosen`, await page.isDisabled(`[data-action="${action}"]`));
  check('R5 name field disabled', await page.isDisabled('[data-field="app-name"]'));
  check('R5 haptics disabled', await page.isDisabled('[data-field="app-haptics"]'));
  check('R5 reason shown', (await page.textContent('#reason-app'))?.includes('먼저 앱을 고르세요'));

  await page.goto(`${base}/arbs/devices/not-a-device`);
  await page.waitForSelector('[data-guard-notice]');
  check('guard: unknown device -> /arbs/devices', new URL(page.url()).pathname === '/arbs/devices', page.url());
  await page.screenshot({ path: join(out, 'G-guard-missing-device.png'), fullPage: true });
  results.shots.push({ name: 'G-guard-missing-device', path: '/arbs/devices/not-a-device', file: 'G-guard-missing-device.png' });
  await page.goto(`${base}/arbs/apps/not-an-app`);
  await page.waitForSelector('[data-guard-notice]');
  check('guard: unknown app -> /arbs/apps', new URL(page.url()).pathname === '/arbs/apps', page.url());
  await page.goto(`${base}/arbs/stream`);
  await page.waitForSelector('[data-guard-notice]');
  check('guard: /arbs/stream -> /arbs/ (no browser stream)', new URL(page.url()).pathname === '/arbs/', page.url());

  await mock({ config: { gamepad: 'x360' } });
  await shot(page, 'R7-controller-not-usbip_ds5', '/arbs/controller');
  check('R7 trigger status disabled', await page.isDisabled('[data-setting="arbs_trigger_status"]'));
  check('R7 HD haptics strength disabled', await page.isDisabled('[data-setting="dualsense_haptics_gain"]'));
  check('R7 warning next to the gamepad type', await page.isVisible('[data-gamepad-warning]'));
  check('R7 precise clock still usable', !(await page.isDisabled('[data-setting="arbs_enet_precise_time"]')));
  await shot(page, 'R7-app-haptics-not-usbip_ds5', `/arbs/apps/${APP}`);
  check('R7 per-app HD haptics disabled', await page.isDisabled('[data-field="app-haptics"]'));
  check('R7 app name editable', !(await page.isDisabled('[data-field="app-name"]')));

  await mock({ config: { controller: 'disabled', gamepad: 'usbip_ds5' } });
  await shot(page, 'R6-controller-input-off', '/arbs/controller');
  check('R6 gamepad type disabled', await page.isDisabled('[data-setting="gamepad"]'));
  check('R6 rumble disabled', await page.isDisabled('[data-setting="forward_rumble"]'));

  // Save path: PATCH /api/config with the new ARBS keys.
  await mock({ reset: true });
  await page.goto(`${base}/arbs/controller`);
  await page.waitForSelector('.page');
  await page.waitForTimeout(300);
  check('R11 save disabled with no change', await page.isDisabled('[data-save]'));
  check('default trigger status h2b', (await page.inputValue('[data-setting="arbs_trigger_status"]')) === 'h2b');
  await page.locator('details[data-advanced]').evaluate((d) => (d.open = true));
  check('default precise clock on', await page.isChecked('[data-setting="arbs_enet_precise_time"]'));
  await page.selectOption('[data-setting="arbs_trigger_status"]', 'disabled');
  await page.uncheck('[data-setting="arbs_enet_precise_time"]');
  check('restart hint after changing trigger status', await page.isVisible('[data-restart-hint]'));
  await page.click('[data-save]');
  await page.waitForSelector('[data-restart]');
  let state = await last();
  check(
    'PATCH body = changed ARBS keys only',
    JSON.stringify(state.lastPatch) === JSON.stringify({ arbs_trigger_status: 'disabled', arbs_enet_precise_time: 'disabled' }),
    JSON.stringify(state.lastPatch),
  );
  await page.screenshot({ path: join(out, 'X-saved-restart-needed.png'), fullPage: false });
  results.shots.push({ name: 'X-saved-restart-needed', path: '/arbs/controller', file: 'X-saved-restart-needed.png' });

  await page.goto(`${base}/arbs/account`);
  await page.waitForSelector('.page');
  await page.check('input[name="arbs-webui-default"][value="classic"]');
  await page.click('[data-save]');
  await page.waitForTimeout(400);
  state = await last();
  check('PATCH arbs_webui_default=classic', JSON.stringify(state.lastPatch) === JSON.stringify({ arbs_webui_default: 'classic' }), JSON.stringify(state.lastPatch));

  await page.goto(`${base}/arbs/devices/${DEV}`);
  await page.waitForSelector('.page');
  await page.fill('.card input.input', 'Odin 2');
  await page.click('[data-action="device-save"]');
  await page.waitForTimeout(400);
  state = await last();
  check(
    'device update keeps unedited fields',
    state.lastClient?.path === '/api/clients/update' && state.lastClient.body.name === 'Odin 2' && Array.isArray(state.lastClient.body.do),
    JSON.stringify(state.lastClient?.body),
  );

  // Links to the other interfaces (top bar).
  await page.goto(`${base}/arbs/`);
  await page.waitForSelector('.page');
  const hrefs = await page.$$eval('.topbar__links a', (as) => as.map((a) => a.getAttribute('href')));
  check('switch links /?ui=classic, /v2/, /settings', JSON.stringify(hrefs) === JSON.stringify(['/?ui=classic', '/v2/', '/settings']), JSON.stringify(hrefs));
  check('footer notice', (await page.textContent('[data-feature="H-V2OV-10"]'))?.includes('based on Vibepollo 2.18.9 (Nonary) · GPL-3.0'));
  check('restart button text', (await page.goto(`${base}/arbs/troubleshoot`), await page.textContent('[data-action="restart"]'))?.trim() === 'ARBS-H 다시 시작');

  // R1 sign-in and first account, R2 offline.
  await mock({ auth: { authenticated: false, credentials_configured: true, login_required: true } });
  await shot(page, 'R1-login', '/arbs/');
  check('R1 login cover shown, cards hidden', (await page.isVisible('[data-feature="H-NAV-12"]')) && !(await page.isVisible('[data-card]')));
  await mock({ auth: { authenticated: false, credentials_configured: false, login_required: true } });
  await shot(page, 'R1-first-account', '/arbs/');
  check('R1 first account form', await page.isVisible('[data-feature="H-AUTH-02"]'));
  await mock({ reset: true });
  await page.goto(`${base}/arbs/`);
  await page.waitForSelector('.page');
  await mock({ offline: true });
  await page.waitForSelector('[data-feature="H-NAV-13"]', { timeout: 20000 });
  await page.screenshot({ path: join(out, 'R2-offline.png'), fullPage: false });
  results.shots.push({ name: 'R2-offline', path: '/arbs/', file: 'R2-offline.png' });
  check('R2 offline cover after heartbeat failures', true);
  await mock({ offline: false });
  await page.waitForSelector('[data-feature="H-NAV-13"]', { state: 'detached', timeout: 20000 });
  check('R2 cover goes away when ARBS-H answers', true);
  await ctx.close();
} finally {
  await browser.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.checks.filter((c) => !c.pass).length;
  console.log(`shots ${results.shots.length}, checks ${results.checks.length}, failed ${failed}`);
  process.exitCode = failed ? 1 : 0;
}
