// ARBS-H UI1b: screenshots of every card (light / dark), disabled states (D-UI-3), narrow width,
// and a few behaviour checks, against scripts/mock-server.mjs. Uses an installed Chrome/Edge
// (no browser download): set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
// H021: sidebar headings, gamepad list / hidden value / trigger states, default apps, statistics.
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
    tag_name: 'v0.2.1',
    name: 'ARBS-H 0.2.1',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/arbs-project/arbs-h/releases/tag/v0.2.1',
    body: 'mock',
    published_at: '2026-11-26T00:00:00Z',
    assets: [{ name: 'arbs-h-0.2.1-setup.exe', state: 'uploaded', size: 1000 }],
  },
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
  await page.evaluate(() => window.scrollTo(0, 0));
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
    ['M-stats', '/arbs/stats', (p) => p.click('[data-detail="cccc0000-0000-4000-8000-000000000003"]').then(() => p.waitForSelector('[data-stats-detail] .stats'))],
    ['T-troubleshoot', '/arbs/troubleshoot'],
    ['U-account', '/arbs/account'],
    [
      'X-common-savebar',
      '/arbs/controller',
      async (p) => {
        await p.locator('details[data-advanced]').evaluate((d) => (d.open = true));
        await p.check('[data-setting="arbs_trigger_status_off"]');
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
        navLabel: get('.nav__label', 'color'),
        navBg: get('.nav', 'backgroundColor'),
      };
    });
    await page.goto(`${base}/arbs/stats`);
    await page.waitForSelector('.stats__row');
    const grades = await page.evaluate(() => {
      const pick = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : '';
      };
      const span = document.createElement('span');
      span.className = 'grade';
      document.querySelector('.stats__row dd').appendChild(span);
      const out = {};
      for (const g of ['good', 'warn', 'bad', 'info']) {
        span.dataset.grade = g;
        out[g] = getComputedStyle(span).color;
      }
      span.remove();
      out.rowBg = pick('.stats__row', 'backgroundColor');
      out.cardBg = pick('.card', 'backgroundColor');
      out.tableHead = pick('.table th', 'color');
      out.selectedRowBg = getComputedStyle(document.documentElement).getPropertyValue('--arbs-primary-tint').trim();
      return out;
    });
    results.contrast[theme] = {
      colors,
      'body text / page': ratio(parse(colors.bodyText), parse(colors.bodyBg)),
      'muted / card': ratio(parse(colors.muted), parse(colors.cardBg)),
      'primary button text / button': ratio(parse(colors.primaryText), parse(colors.primaryBg)),
      'link / page': ratio(parse(colors.link), parse(colors.bodyBg)),
      'current menu / tint': ratio(parse(colors.navCurrent), parse(colors.navCurrentBg)),
      'reason / card': ratio(parse(colors.reasonText), parse(colors.cardBg)),
      'menu heading / menu': ratio(parse(colors.navLabel), parse(colors.navBg === 'rgba(0, 0, 0, 0)' ? colors.bodyBg : colors.navBg)),
      grades,
      'grade good / row': ratio(parse(grades.good), parse(grades.rowBg)),
      'grade warn / row': ratio(parse(grades.warn), parse(grades.rowBg)),
      'grade bad / row': ratio(parse(grades.bad), parse(grades.rowBg)),
      'grade info / row': ratio(parse(grades.info), parse(grades.rowBg)),
      'grade good / card': ratio(parse(grades.good), parse(grades.cardBg)),
      'grade warn / card': ratio(parse(grades.warn), parse(grades.cardBg)),
      'grade bad / card': ratio(parse(grades.bad), parse(grades.cardBg)),
      'table head / card': ratio(parse(grades.tableHead), parse(grades.cardBg)),
    };
    for (const [name, value] of Object.entries(results.contrast[theme])) {
      if (typeof value === 'number') check(`${theme}: contrast ${name} >= 4.5`, value >= 4.5, String(value));
    }
    // Sidebar: headings are not links; links are under them; stats in the manage group.
    const navInfo = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('#arbs-nav [role="group"]')];
      return groups.map((g) => {
        const h = document.getElementById(g.getAttribute('aria-labelledby'));
        return {
          heading: h?.tagName,
          headingText: h?.textContent?.trim(),
          headingCursor: h ? getComputedStyle(h).cursor : '',
          links: [...g.querySelectorAll('a.nav__link')].map((a) => a.getAttribute('href')),
          headingIsLink: Boolean(h?.closest('a')),
        };
      });
    });
    results.nav = navInfo;
    check(`${theme}: 4 menu groups with h2 headings`, navInfo.length === 4 && navInfo.every((g) => g.heading === 'H2' && !g.headingIsLink));
    check(`${theme}: heading cursor default`, navInfo.every((g) => g.headingCursor === 'default'), navInfo.map((g) => g.headingCursor).join(','));
    check(`${theme}: stats link in manage group`, navInfo[3]?.links?.[0] === '/arbs/stats', JSON.stringify(navInfo[3]?.links));
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

  // H021 states, light and dark.
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true });
    const ctx = await context(browser, theme);
    const page = await ctx.newPage();
    await shot(page, `H-sidebar-${theme}`, '/arbs/stats', async (p) => {
      await p.locator('#arbs-nav a[href="/arbs/stats"]').hover();
    });
    await page.locator('#arbs-nav').screenshot({ path: join(out, `H-sidebar-only-${theme}.png`) });
    results.shots.push({ name: `H-sidebar-only-${theme}`, path: '/arbs/stats', file: `H-sidebar-only-${theme}.png` });

    await shot(page, `H-controller-usbip_ds5-${theme}`, '/arbs/controller', (p) => p.locator('details[data-advanced]').evaluate((d) => (d.open = true)));
    const values = await page.$$eval('[data-setting="gamepad"] option', (os) => os.map((o) => o.value));
    check(`${theme}: gamepad list = usbip_ds5, auto`, JSON.stringify(values) === JSON.stringify(['usbip_ds5', 'auto']), JSON.stringify(values));
    const triggers = await page.$$eval('[data-setting="arbs_trigger_status"] option', (os) => os.map((o) => o.value));
    check(`${theme}: trigger options = h2b only`, JSON.stringify(triggers) === JSON.stringify(['h2b']), JSON.stringify(triggers));
    check(`${theme}: no hidden-value warning for usbip_ds5`, !(await page.isVisible('[data-gamepad-warning]')));

    await mock({ config: { gamepad: 'vhf_xbox', arbs_trigger_status: 'enabled' } });
    await shot(page, `H-controller-hidden-vhf_xbox-enabled-${theme}`, '/arbs/controller');
    const hidden = await page.$$eval('[data-setting="gamepad"] option', (os) => os.map((o) => [o.value, o.dataset.hiddenValue ?? '']));
    check(`${theme}: hidden current value shown at the end`, JSON.stringify(hidden) === JSON.stringify([['usbip_ds5', ''], ['auto', ''], ['vhf_xbox', 'true']]), JSON.stringify(hidden));
    check(`${theme}: hidden value selected as is`, (await page.inputValue('[data-setting="gamepad"]')) === 'vhf_xbox');
    check(
      `${theme}: hidden value warning text`,
      (await page.textContent('[data-gamepad-warning]'))?.trim() === '아직 ARBS에서 확인되지 않은 종류입니다. ARBS에는 DualSense(usbip_ds5)를 권장합니다.',
    );
    check(`${theme}: vhf_xbox disables trigger status`, await page.isDisabled('[data-setting="arbs_trigger_status"]'));
    check(`${theme}: vhf_xbox reason text`, (await page.textContent('#reason-ds'))?.includes('DualSense로 연결될 때만 적용됩니다(usbip_ds5 권장)'));
    check(`${theme}: enabled shown with h2b note`, (await page.inputValue('[data-setting="arbs_trigger_status"]')) === 'enabled' && (await page.isVisible('[data-trigger-enabled-note]')));
    check(`${theme}: nothing changed by showing a hidden value`, await page.isDisabled('[data-save]'));

    await mock({ config: { gamepad: 'vhf_ds5', arbs_trigger_status: 'h2b' } });
    await shot(page, `H-controller-hidden-vhf_ds5-${theme}`, '/arbs/controller');
    check(`${theme}: vhf_ds5 (makes a DualSense) keeps trigger status usable`, !(await page.isDisabled('[data-setting="arbs_trigger_status"]')));
    check(`${theme}: vhf_ds5 shows the hidden-value warning`, await page.isVisible('[data-gamepad-warning]'));

    await mock({ config: { gamepad: 'auto' } });
    await page.goto(`${base}/arbs/controller`);
    await page.waitForSelector('.page');
    await page.waitForTimeout(300);
    check(`${theme}: auto keeps trigger status and gain usable`, !(await page.isDisabled('[data-setting="arbs_trigger_status"]')) && !(await page.isDisabled('[data-setting="dualsense_haptics_gain"]')));

    await mock({ reset: true });
    await shot(page, `H-apps-defaults-${theme}`, '/arbs/apps', (p) => p.locator('details.details').evaluate((d) => (d.open = true)));
    const badges = await page.$$eval('.list__row', (rows) => rows.map((r) => [r.querySelector('strong')?.textContent?.trim(), r.querySelector('[data-badge]')?.getAttribute('data-badge')]));
    check(
      `${theme}: 4 default apps have the default badge`,
      ['Desktop', 'Steam Big Picture', 'Remote Input', 'Remote Monitor'].every((n) => badges.some(([name, b]) => name === n && b === 'default')),
      JSON.stringify(badges),
    );
    check(`${theme}: library apps keep their badges`, badges.some(([n, b]) => n === 'Elden Ring' && b === 'steam') && badges.some(([n, b]) => n === 'Astro Bot' && b === 'playnite'));
    check(`${theme}: 4 two-line descriptions`, (await page.$$('[data-app-about]')).length === 4);
    check(`${theme}: "not ARBS" note on Remote Input and Monitor only`, (await page.$$('[data-not-arbs]')).length === 2);
    check(`${theme}: restore buttons disabled (all present)`, (await page.isDisabled('[data-restore="desktop"]')) && (await page.isDisabled('[data-restore="monitor"]')) && (await page.isDisabled('[data-restore="input"]')));
    check(`${theme}: Steam Big Picture restore note`, await page.isVisible('[data-steam-bp-note]'));

    await mock({ config: { gamepad: 'x360' } });
    await shot(page, `H-app-haptics-x360-${theme}`, `/arbs/apps/${APP}`);
    check(`${theme}: per-app HD haptics usable with x360`, !(await page.isDisabled('[data-field="app-haptics"]')));

    await mock({ reset: true });
    await shot(page, `H-stats-${theme}`, '/arbs/stats', (p) =>
      p.click('[data-detail="cccc0000-0000-4000-8000-000000000002"]').then(() => p.waitForSelector('[data-stats-detail] .stats')),
    );
    check(`${theme}: stats live numbers`, (await page.$$('[data-live-source="history"] .stats__row')).length === 9);
    check(`${theme}: stats recent rows`, (await page.$$('[data-recent]')).length === 3);
    check(`${theme}: stats detail rows`, (await page.$$('[data-stats-detail] .stats__row')).length === 7);
    check(`${theme}: encode latency label (not network)`, (await page.textContent('[data-live-source="history"] [data-metric="latency"] dt'))?.trim() === '인코딩 지연');
    check(`${theme}: round-trip note`, await page.isVisible('[data-rtt-note]'));
    await ctx.close();
  }

  // Stats with no stream and history off (RTSP fallback not needed: nothing streaming).
  {
    await mock({ reset: true, historyOff: true, session: { activeSessions: 0, appRunning: false, status: true } });
    const ctx = await context(browser, 'light');
    const page = await ctx.newPage();
    await shot(page, 'H-stats-idle-history-off-light', '/arbs/stats');
    check('stats idle: no live session text', await page.isVisible('[data-stats-live-none]'));
    check('stats history off notice', await page.isVisible('[data-history-off]'));
    check('stats history switch usable when not streaming', !(await page.isDisabled('[data-setting="session_history_enabled"]')));
    await mock({ reset: true, historyOff: true });
    await shot(page, 'H-stats-rtsp-fallback-light', '/arbs/stats');
    check('stats RTSP fallback while history is off', await page.isVisible('[data-live-rtsp-note]'));
    check('stats history switch disabled while streaming', await page.isDisabled('[data-setting="session_history_enabled"]'));
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
  check('H021: per-app HD haptics usable whatever the gamepad type', !(await page.isDisabled('[data-field="app-haptics"]')));
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
  check('default trigger options = h2b only', JSON.stringify(await page.$$eval('[data-setting="arbs_trigger_status"] option', (os) => os.map((o) => o.value))) === '["h2b"]');
  await page.check('[data-setting="arbs_trigger_status_off"]');
  check('advanced off switch selects disabled', (await page.inputValue('[data-setting="arbs_trigger_status"]')) === 'disabled');
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
