// ARBS-H UI1b: screenshots of every card (light / dark), disabled states (D-UI-3), narrow width,
// and a few behaviour checks, against scripts/mock-server.mjs. Uses an installed Chrome/Edge
// (no browser download): set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
// H021: sidebar headings, gamepad list / hidden value / trigger states, default apps, statistics.
// H022: orange group titles (wide page + narrow drawer), history days default 30.
// NET2 (0.3.0): remote access wizard (all steps light/dark, 390 px), hiding, blocks, port change, drawer + save bar.
// H031 (0.3.1): hold-to-show with a real mouse / touch / keyboard, 3b router only, 4 outside value (router answer or
// typed, documentation address 203.0.113.7 only), 5 finish summary, no setting key names, ARBS icon on the web screens.
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
    tag_name: 'v0.3.1',
    name: 'ARBS-H 0.3.1',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/arbs-project/arbs-h/releases/tag/v0.3.1',
    body: 'mock',
    published_at: '2026-11-29T00:00:00Z',
    assets: [{ name: 'arbs-h-0.3.1-setup.exe', state: 'uploaded', size: 1000 }],
  },
  {
    tag_name: 'v0.3.0',
    name: 'ARBS-H 0.3.0',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/arbs-project/arbs-h/releases/tag/v0.3.0',
    body: 'mock',
    published_at: '2026-11-28T00:00:00Z',
    assets: [{ name: 'arbs-h-0.3.0-setup.exe', state: 'uploaded', size: 1000 }],
  },
  {
    tag_name: 'v0.2.2',
    name: 'ARBS-H 0.2.2',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/arbs-project/arbs-h/releases/tag/v0.2.2',
    body: 'mock',
    published_at: '2026-11-27T00:00:00Z',
    assets: [{ name: 'arbs-h-0.2.2-setup.exe', state: 'uploaded', size: 1000 }],
  },
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

  // H022: orange group titles (light #c2410c / dark #f97316), current item bold, history days 30.
  const H022_TITLE = { light: 'rgb(194, 65, 12)', dark: 'rgb(249, 115, 22)' };
  const H022_TTL_HELP = '이 일수보다 오래된 기록을 지웁니다. 0 = 지우지 않음. 기본 30일.';
  results.h022 = {};
  for (const theme of ['light', 'dark']) {
    const info = {};
    // Wide page: the menu has no background of its own (page background).
    await mock({ reset: true });
    let ctx = await context(browser, theme);
    let page = await ctx.newPage();
    await shot(page, `H022-sidebar-${theme}`, '/arbs/stats');
    await page.locator('#arbs-nav').screenshot({ path: join(out, `H022-sidebar-only-${theme}.png`) });
    results.shots.push({ name: `H022-sidebar-only-${theme}`, path: '/arbs/stats', file: `H022-sidebar-only-${theme}.png` });
    info.wide = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const labels = [...document.querySelectorAll('#arbs-nav .nav__label')].map((h) => ({
        color: cs(h).color,
        weight: cs(h).fontWeight,
        size: cs(h).fontSize,
        opacity: cs(h).opacity,
      }));
      const nav = document.querySelector('.nav');
      const cur = document.querySelector('.nav__link--current');
      const plain = document.querySelector('.nav__link:not(.nav__link--current)');
      return {
        labels,
        navBg: cs(nav).backgroundColor,
        bodyBg: cs(document.body).backgroundColor,
        bodyText: cs(document.body).color,
        current: { color: cs(cur).color, bg: cs(cur).backgroundColor, weight: cs(cur).fontWeight, bar: cs(cur).borderLeftColor },
        plain: { color: cs(plain).color, weight: cs(plain).fontWeight },
      };
    });
    const w = info.wide;
    const wideBg = w.navBg === 'rgba(0, 0, 0, 0)' ? w.bodyBg : w.navBg;
    check(`H022 ${theme}: 4 titles orange ${H022_TITLE[theme]}`, w.labels.length === 4 && w.labels.every((l) => l.color === H022_TITLE[theme]), JSON.stringify(w.labels.map((l) => l.color)));
    check(`H022 ${theme}: titles 600 weight, 12px or less, no opacity`, w.labels.every((l) => l.weight === '600' && parseFloat(l.size) <= 12 && l.opacity === '1'), JSON.stringify(w.labels[0]));
    check(`H022 ${theme}: plain item = body text colour`, w.plain.color === w.bodyText, `${w.plain.color} / ${w.bodyText}`);
    check(`H022 ${theme}: current item bold 700`, w.current.weight === '700', w.current.weight);
    info.ratioWide = ratio(parse(w.labels[0].color), parse(wideBg));
    info.ratioCurrent = ratio(parse(w.current.color), parse(w.current.bg));
    check(`H022 ${theme}: contrast title / menu (wide) >= 4.5`, info.ratioWide >= 4.5, String(info.ratioWide));
    check(`H022 ${theme}: contrast current item / tint >= 4.5`, info.ratioCurrent >= 4.5, String(info.ratioCurrent));

    // History settings: no key in the config file = 30, help text, 0 is written explicitly.
    await shot(page, `H022-stats-history-settings-${theme}`, '/arbs/stats', (p) => p.locator('details[data-advanced]').evaluate((d) => (d.open = true)));
    info.ttlValue = await page.inputValue('[data-setting="session_history_ttl_days"]');
    info.ttlHelp = (await page.textContent('#help-history-ttl'))?.trim();
    check(`H022 ${theme}: history days shows 30 when the key is missing`, info.ttlValue === '30', info.ttlValue);
    check(`H022 ${theme}: history days help text`, info.ttlHelp === H022_TTL_HELP, info.ttlHelp);
    await ctx.close();

    // Narrow width: the menu opens as a drawer on the surface colour.
    await mock({ reset: true });
    ctx = await context(browser, theme, { width: 390, height: 844 });
    page = await ctx.newPage();
    await shot(page, `H022-drawer-390-${theme}`, '/arbs/stats', (p) => p.click('.topbar__menu'));
    info.drawer = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      return {
        label: cs(document.querySelector('#arbs-nav .nav__label')).color,
        navBg: cs(document.querySelector('.nav')).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--arbs-surface').trim(),
        display: cs(document.querySelector('.nav')).display,
      };
    });
    info.ratioDrawer = ratio(parse(info.drawer.label), parse(info.drawer.navBg));
    check(`H022 ${theme}: drawer open`, info.drawer.display !== 'none', info.drawer.display);
    check(`H022 ${theme}: contrast title / drawer surface >= 4.5`, info.ratioDrawer >= 4.5, `${info.ratioDrawer} on ${info.drawer.navBg}`);
    await ctx.close();
    results.h022[theme] = info;
  }
  {
    // A value already in the config file (0) is shown as is; choosing 0 from 30 is sent as '0'.
    await mock({ reset: true, config: { session_history_ttl_days: '0' } });
    let ctx = await context(browser, 'light');
    let page = await ctx.newPage();
    await page.goto(`${base}/arbs/stats`);
    await page.waitForSelector('.page');
    await page.waitForTimeout(300);
    check('H022: history days keeps a saved 0', (await page.inputValue('[data-setting="session_history_ttl_days"]')) === '0');
    await ctx.close();
    await mock({ reset: true });
    ctx = await context(browser, 'light');
    page = await ctx.newPage();
    await page.goto(`${base}/arbs/stats`);
    await page.waitForSelector('.page');
    await page.waitForTimeout(300);
    await page.locator('details[data-advanced]').evaluate((d) => (d.open = true));
    await page.fill('[data-setting="session_history_ttl_days"]', '0');
    await page.dispatchEvent('[data-setting="session_history_ttl_days"]', 'change');
    await page.click('[data-save]');
    await page.waitForTimeout(400);
    const state = await last();
    check('H022: PATCH 30 -> 0 writes session_history_ttl_days "0"', JSON.stringify(state.lastPatch) === JSON.stringify({ session_history_ttl_days: '0' }), JSON.stringify(state.lastPatch));
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

  // NET2 (0.3.0): "외부 접속" wizard. The mock's addresses are format examples (100.x.y.z, 192.168.x.y); every shot
  // shows them hidden (●●●) except the one reveal shot, which shows only that example form.
  const MASK = '●●●';
  const NET2_STEPS = ['0', '1', '2', '3a', '3b', '3c', '3d', '4', '5'];
  const WIZARD_KEYS = ['upnp', 'origin_web_ui_allowed', 'port', 'lan_encryption_mode', 'wan_encryption_mode', 'enable_pairing'];
  results.net2 = {};
  async function step(page, s, query = '') {
    await page.goto(`${base}/arbs/remote?step=${s}${query}`);
    await page.waitForSelector(`[data-remote-step="${s}"]`, { timeout: 15000 });
    await page.waitForTimeout(250);
    if (s === '5') await page.$eval('[data-advanced-revert]', (d) => (d.open = true)).catch(() => undefined);
  }
  async function addressesMasked(page) {
    const texts = await page.$$eval('[data-address]', (els) => els.map((e) => e.textContent.trim()));
    return texts.every((t) => t.startsWith('●●●') && !/x\.y/.test(t));
  }
  for (const theme of ['light', 'dark']) {
    const info = {};
    await mock({ reset: true });
    const ctx = await context(browser, theme);
    const page = await ctx.newPage();
    for (const s of NET2_STEPS) {
      await shot(page, `NET2-step${s}-${theme}`, `/arbs/remote?step=${s}`, (p) => p.waitForSelector(`[data-remote-step="${s}"]`));
      const never = await page.$$eval('[data-never]', (els) => els.map((e) => e.textContent.trim()));
      check(`NET2 ${theme} step ${s}: red "never open" box (TCP 47990, USB/IP 3240)`, never.length === 2 && never[0].includes('TCP 47990') && never[1].includes('3240'), JSON.stringify(never));
      check(`NET2 ${theme} step ${s}: addresses hidden`, await addressesMasked(page));
    }
    await step(page, '3a');
    info.colors = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const cur = document.querySelector('.remote__step[aria-current="step"]');
      const banner = document.querySelector('[data-never-open]');
      const never = document.querySelector('[data-never]');
      const text = document.querySelector('.diagram__text');
      const sub = document.querySelector('.diagram__sub');
      const box = document.querySelector('.diagram__box');
      const code = document.querySelector('[data-address]');
      const step = document.querySelector('.remote__step:not([aria-current])');
      return {
        current: [cs(cur).color, cs(cur).backgroundColor],
        step: [cs(step).color, cs(step).backgroundColor],
        never: [cs(never).color, cs(banner).backgroundColor],
        neverHelp: [cs(banner.querySelector('.muted')).color, cs(banner).backgroundColor],
        diagramText: [cs(text).fill, cs(box).fill],
        diagramSub: [cs(sub).fill, cs(box).fill],
        address: [cs(code).color, cs(code).backgroundColor],
      };
    });
    info.contrast = Object.fromEntries(Object.entries(info.colors).map(([k, [fg, bg]]) => [k, ratio(parse(fg), parse(bg))]));
    for (const [k, v] of Object.entries(info.contrast)) check(`NET2 ${theme}: contrast ${k} >= 4.5`, v >= 4.5, String(v));
    await step(page, '1');
    info.grades = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector('[data-remote-step="1"]')).backgroundColor;
      return [...document.querySelectorAll('[data-remote-step="1"] .grade')].map((g) => [g.dataset.grade, getComputedStyle(g).color, card]);
    });
    for (const [g, fg, bg] of info.grades) check(`NET2 ${theme}: grade ${g} / card >= 4.5`, ratio(parse(fg), parse(bg)) >= 4.5, String(ratio(parse(fg), parse(bg))));
    await ctx.close();
    results.net2[theme] = info;
  }

  {
    // Behaviour (light).
    await mock({ reset: true });
    const ctx = await context(browser, 'light');
    const page = await ctx.newPage();
    const navHref = await page.goto(`${base}/arbs/`).then(() => page.waitForSelector('.page')).then(() =>
      page.$$eval('#arbs-nav [role="group"]', (gs) => gs.map((g) => [...g.querySelectorAll('a')].map((a) => a.getAttribute('href')))),
    );
    check('NET2 menu: 외부 접속 in the connect group', JSON.stringify(navHref[1]) === JSON.stringify(['/arbs/devices', '/arbs/apps', '/arbs/remote']), JSON.stringify(navHref[1]));

    await step(page, '1');
    const grades = await page.$$eval('[data-check]', (els) => Object.fromEntries(els.map((e) => [e.dataset.check, e.dataset.checkGrade])));
    check('NET2 step 1 default port: listeners ok, risk ok, overlap warn', grades.listeners === 'good' && grades.risk === 'good' && grades.overlap === 'warn', JSON.stringify(grades));
    check('NET2 step 1 overlap row links to "포트 바꾸기"', await page.isVisible('[data-go-3d]'));
    await mock({ net: { fail: true } });
    await step(page, '1');
    check('NET2 step 1 falls back to /api/config when the diagnostics API fails', await page.isVisible('[data-diag-fallback]'));
    await mock({ net: { fail: false } });

    await step(page, '2');
    check('NET2 step 2 default (not sure) = Tailscale', (await page.getAttribute('[data-recommend]', 'data-recommend')) === 'tailscale' && (await page.isVisible('[data-note="unknown_means_tailscale"]')));
    await page.check('[data-answer-router="yes"]');
    await page.check('[data-answer-wan="yes"]');
    check('NET2 step 2 yes + yes = port forwarding possible', (await page.getAttribute('[data-recommend]', 'data-recommend')) === 'forward');
    check('NET2 step 2 text names other VPNs (예: Tailscale, ZeroTier)', (await page.textContent('[data-remote-step="2"]')).includes('예: Tailscale, ZeroTier'));

    await step(page, '3a');
    check('NET2 3a default port: address hidden, no :port', (await page.textContent('[data-tailnet] [data-address]')).trim() === MASK);
    await mock({ config: { port: '45989' } });
    await step(page, '3a');
    check('NET2 3a port 45989: hidden address + :45989', (await page.textContent('[data-tailnet] [data-address]')).trim() === `${MASK}:45989`);
    check('NET2 3a port 45989: ":port" note shown', await page.isVisible('[data-port-suffix]'));
    const rv = await page.locator('[data-tailnet] [data-reveal]').boundingBox();
    await page.mouse.move(rv.x + 6, rv.y + rv.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const shownText = (await page.textContent('[data-tailnet] [data-address]')).trim();
    check('NET2 3a reveal while pressed shows the example form 100.x.y.z:45989', shownText === '100.x.y.z:45989', shownText);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(out, 'NET2-step3a-reveal-example-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step3a-reveal-example-light', path: '/arbs/remote?step=3a', file: 'NET2-step3a-reveal-example-light.png' });
    await page.mouse.up();
    await page.waitForTimeout(100);
    check('NET2 3a released: hidden again', (await page.textContent('[data-tailnet] [data-address]')).trim() === `${MASK}:45989`);
    try {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await page.click('[data-copy]');
      await page.waitForTimeout(200);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check('NET2 3a copy works while hidden (example form)', clip === '100.x.y.z:45989', clip);
    } catch (e) {
      check('NET2 3a copy works while hidden (example form)', false, String(e).slice(0, 120));
    }
    await page.click('[data-action="lan-enc-on"]');
    await page.waitForTimeout(300);
    check('NET2 3a lan encryption 0 -> 1 PATCH', JSON.stringify((await last()).lastPatch) === JSON.stringify({ lan_encryption_mode: '1' }), JSON.stringify((await last()).lastPatch));

    await mock({ reset: true });
    await step(page, '3b');
    const rows = await page.$$eval('[data-port-table] tbody tr', (trs) => trs.map((tr) => tr.dataset.row));
    check('NET2 3b table = TCP 47984 47989 48010 + UDP 47998 47999 48000 (no 47990)', JSON.stringify(rows) === JSON.stringify(['tcp-47984', 'tcp-47989', 'tcp-48010', 'udp-47998', 'udp-47999', 'udp-48000']), JSON.stringify(rows));
    check('NET2 3b local address hidden', (await page.textContent('[data-local] [data-address]')).trim() === MASK);
    check('NET2 3b official router guides only (ASUS, TP-Link), STACKON hidden while empty', JSON.stringify(await page.$$eval('[data-guide]', (as) => as.map((a) => a.dataset.guide))) === '["asus","tplink"]');
    check('H031 3b has no new pairing switch (moved to step 4)', !(await page.isVisible('[data-action="pairing-off"]')));
    await step(page, '4');
    await page.click('[data-action="pairing-off"]');
    await page.waitForSelector('[data-action="pairing-on"]');
    check('H031 4 new pairing off PATCH + turn-on button', JSON.stringify((await last()).lastPatch) === JSON.stringify({ enable_pairing: 'disabled' }));

    await mock({ reset: true, config: { origin_web_ui_allowed: 'wan' } });
    await step(page, '1');
    check('NET2 step 1 origin=wan: risk', (await page.getAttribute('[data-check="risk"]', 'data-check-grade')) === 'bad');
    await step(page, '3c');
    check('NET2 3c origin=wan: UPnP on is blocked with the reason', (await page.isDisabled('[data-action="upnp-on"]')) && (await page.isVisible('#reason-upnp')));
    await page.screenshot({ path: join(out, 'NET2-step3c-blocked-wan-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step3c-blocked-wan-light', path: '/arbs/remote?step=3c', file: 'NET2-step3c-blocked-wan-light.png' });
    const before = (await last()).patches?.length ?? 0;
    await page.click('[data-action="upnp-on"]', { force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    check('NET2 3c blocked button sends nothing', ((await last()).patches?.length ?? 0) === before);
    await page.click('[data-remote-step="3c"] [data-action="origin-lan"]');
    await page.waitForTimeout(300);
    check('NET2 3c "집 안에서만" PATCH origin_web_ui_allowed=lan', JSON.stringify((await last()).lastPatch) === JSON.stringify({ origin_web_ui_allowed: 'lan' }));
    check('NET2 3c after lan: UPnP on usable', !(await page.isDisabled('[data-action="upnp-on"]')));
    await page.click('[data-action="upnp-on"]');
    await page.waitForSelector('[data-remote-restart]');
    check('NET2 3c UPnP on PATCH + restart needed', JSON.stringify((await last()).lastPatch) === JSON.stringify({ upnp: 'enabled' }));

    // S3 on step 5 (EA-NET2-V-01 B1 path): origin was wan, now lan + UPnP on -> "이전 값으로" for origin is blocked.
    await step(page, '5');
    check('NET2 step 5 origin back to wan is blocked while UPnP is on (reason shown)', (await page.isDisabled('[data-revert="origin_web_ui_allowed"]')) && (await page.isVisible('#reason-revert-origin_web_ui_allowed')));
    check('NET2 step 5 blocked revert points to its reason', (await page.getAttribute('[data-revert="origin_web_ui_allowed"]', 'aria-describedby')) === 'reason-revert-origin_web_ui_allowed');
    check('NET2 step 5 UPnP revert (to off) stays usable', !(await page.isDisabled('[data-revert="upnp"]')));
    await page.screenshot({ path: join(out, 'NET2-step5-revert-blocked-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step5-revert-blocked-light', path: '/arbs/remote?step=5', file: 'NET2-step5-revert-blocked-light.png' });
    const beforeRevert = (await last()).patches?.length ?? 0;
    await page.click('[data-revert="origin_web_ui_allowed"]', { force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    check('NET2 step 5 blocked revert sends nothing', ((await last()).patches?.length ?? 0) === beforeRevert);
    await page.click('[data-revert="upnp"]');
    await page.waitForTimeout(400);
    check('NET2 step 5 UPnP back to its value before (no line)', JSON.stringify((await last()).lastPatch) === JSON.stringify({ upnp: '' }));
    check('NET2 step 5 origin revert usable once UPnP is off', !(await page.isDisabled('[data-revert="origin_web_ui_allowed"]')) && !(await page.isVisible('#reason-revert-origin_web_ui_allowed')));
    // Other direction: UPnP back to on while origin = wan.
    await mock({ reset: true, config: { origin_web_ui_allowed: 'wan', upnp: 'disabled' } });
    const savedChanges = await page.evaluate(() => sessionStorage.getItem('arbs.remote.changes'));
    await page.evaluate(() => sessionStorage.setItem('arbs.remote.changes', JSON.stringify([{ key: 'upnp', before: 'enabled', after: 'disabled' }])));
    await step(page, '5');
    check('NET2 step 5 UPnP back to on is blocked while origin = wan (reason shown)', (await page.isDisabled('[data-revert="upnp"]')) && (await page.isVisible('#reason-revert-upnp')));
    const beforeUpnp = (await last()).patches?.length ?? 0;
    await page.click('[data-revert="upnp"]', { force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    check('NET2 step 5 blocked UPnP revert sends nothing', ((await last()).patches?.length ?? 0) === beforeUpnp);
    await page.evaluate((text) => sessionStorage.setItem('arbs.remote.changes', text ?? '[]'), savedChanges);

    await mock({ reset: true, net: { port: 47989 } });
    await step(page, '3d');
    check('NET2 3d benefit line', (await page.textContent('[data-port-benefit]')).includes('Vibepollo·Apollo'));
    await page.fill('[data-field="new-port"]', '1028');
    check('NET2 3d 1028 blocked', (await page.isVisible('[data-port-error]')) && (await page.isDisabled('[data-action="port-save"]')));
    await page.fill('[data-field="new-port"]', '47963');
    check('NET2 3d 47963 overlaps the Sunshine family', await page.isVisible('[data-port-warning="overlaps_sunshine"]'));
    await page.fill('[data-field="new-port"]', '49131');
    check('NET2 3d 49131 dynamic range warning', await page.isVisible('[data-port-warning="dynamic_range"]'));
    await page.click('[data-action="port-arbs"]');
    check('NET2 3d "ARBS 권장 포트" fills 45989', (await page.inputValue('[data-field="new-port"]')) === '45989');
    check('NET2 3d preview of 45989', (await page.textContent('[data-port-preview]')).replace(/\s+/g, ' ').trim() === 'TCP 45984, 45989, 46010 · UDP 45998, 45999, 46000');
    check('NET2 3d value before shown', (await page.textContent('[data-port-before]')).includes('(없음 = 기본값)'));
    await page.click('[data-action="port-save"]');
    await page.waitForSelector('[data-moved]');
    check('NET2 3d save PATCH port=45989', JSON.stringify((await last()).lastPatch) === JSON.stringify({ port: '45989' }));
    const href = await page.getAttribute('[data-new-link]', 'href');
    const linkText = (await page.textContent('[data-new-link]')).trim();
    check('NET2 3d new link = web UI port 45990, back to step 5 with prev_port 47989', /^https:\/\/[^/]+:45990\/arbs\/remote\?step=5&prev_port=47989$/.test(href), href.replace(/\/\/[^/:]+/, '//<host>'));
    check('NET2 3d new link text hides the host', linkText === `https://${MASK}:45990/arbs/remote`, linkText);
    check('NET2 3d restart button after a port change', await page.isVisible('[data-action="remote-restart"]'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(out, 'NET2-step3d-saved-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step3d-saved-light', path: '/arbs/remote?step=3d', file: 'NET2-step3d-saved-light.png' });
    await step(page, '5');
    check('NET2 step 5 lists the port change (before = none)', (await page.textContent('[data-change="port"]')).includes('(없음 = 기본값)'));
    await page.screenshot({ path: join(out, 'NET2-step5-changes-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step5-changes-light', path: '/arbs/remote?step=5', file: 'NET2-step5-changes-light.png' });
    await page.click('[data-revert="port"]');
    await page.waitForTimeout(400);
    check('NET2 step 5 "이전 값으로" PATCH port="" (no line again)', JSON.stringify((await last()).lastPatch) === JSON.stringify({ port: '' }));
    check('NET2 step 5 port row gone after the undo (other changes stay)', !(await page.isVisible('[data-change="port"]')) && (await page.isVisible('[data-change="enable_pairing"]')));
    check('H031 step 5 has no internet encryption line (D8 value not shown or changed)', !(await page.isVisible('[data-wan-enc]')));
    const keys = [...new Set(((await last()).patches ?? []).flatMap((p) => Object.keys(p)))];
    check('NET2 all wizard PATCHes use the 6 allowed keys only', keys.every((k) => WIZARD_KEYS.includes(k)), JSON.stringify(keys));
    await ctx.close();

    // After the restart on the new port: the page opens from the new link (fresh sessionStorage), prev_port carries the old port.
    await mock({ reset: true, config: { port: '45989' } });
    const ctx2 = await context(browser, 'light');
    const page2 = await ctx2.newPage();
    await step(page2, '5', '&prev_port=47989');
    check('NET2 prev_port: step 5 shows port 47989 -> 45989 to undo', (await page2.textContent('[data-change="port"]')).includes('47989') && (await page2.textContent('[data-change="port"]')).includes('45989'));
    await page2.screenshot({ path: join(out, 'NET2-step5-prev-port-light.png'), fullPage: true });
    results.shots.push({ name: 'NET2-step5-prev-port-light', path: '/arbs/remote?step=5&prev_port=47989', file: 'NET2-step5-prev-port-light.png' });
    await step(page2, '0');
    check('NET2 step 0 with 45989: ARBS port family note', await page2.isVisible('[data-arbs-port-note]'));
    await step(page2, '3b');
    const rows2 = await page2.$$eval('[data-port-table] tbody tr', (trs) => trs.map((tr) => tr.dataset.row));
    check('NET2 3b table follows the port (45989)', JSON.stringify(rows2) === JSON.stringify(['tcp-45984', 'tcp-45989', 'tcp-46010', 'udp-45998', 'udp-45999', 'udp-46000']), JSON.stringify(rows2));
    check('NET2 never-open box follows the port (TCP 45990)', (await page2.textContent('[data-never="web_ui"]')).includes('TCP 45990'));
    await ctx2.close();
  }

  // ---------------------------------------------------------------------------------------------
  // H031 (0.3.1). Addresses: hidden (●●●) or the documentation example 203.0.113.7 / format examples (100.x.y.z,
  // 192.168.x.y) from the mock. Every "보기" is pressed with the real mouse / touch / keyboard (no synthetic events).
  // ---------------------------------------------------------------------------------------------
  results.h031 = { requests: [], shots: [] };
  const DOC = '203.0.113.7';
  async function h031Shot(page, name, viewportToo = true) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    results.shots.push({ name, path: new URL(page.url()).pathname + new URL(page.url()).search, file: `${name}.png` });
    if (viewportToo) {
      await page.screenshot({ path: join(out, `${name}-viewport.png`), fullPage: false });
      results.shots.push({ name: `${name}-viewport`, path: new URL(page.url()).pathname, file: `${name}-viewport.png` });
    }
  }
  /** Real mouse press on a "보기": returns the shown text after 150 ms, after an 80 px drag, after letting go. */
  async function mouseHold(page, row, where = 'left') {
    const btn = page.locator(`${row} [data-reveal]`).first();
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    const x = where === 'left' ? box.x + 5 : box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const during = (await page.textContent(`${row} [data-address]`)).trim();
    const moved = await btn.boundingBox();
    await page.mouse.move(x + 80, y + 30, { steps: 4 });
    await page.waitForTimeout(100);
    const dragged = (await page.textContent(`${row} [data-address]`)).trim();
    return {
      during,
      dragged,
      sameSpot: Math.round(moved.x) === Math.round(box.x) && Math.round(moved.y) === Math.round(box.y),
      release: async () => {
        await page.mouse.up();
        await page.waitForTimeout(120);
        return (await page.textContent(`${row} [data-address]`)).trim();
      },
    };
  }
  function trackRequests(ctx) {
    ctx.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== '127.0.0.1') results.h031.requests.push(u.hostname);
    });
  }
  const visibleTextHasKeys = (page) =>
    page.evaluate(() => {
      const text = document.querySelector('[data-page="remote"]').innerText;
      return (text.match(/[a-z0-9]+_[a-z0-9_]+|origin_web_ui_allowed|encryption_mode|enable_pairing|\((lan|wan|pc)\)/g) ?? []).filter((m) => !/^\d/.test(m));
    });

  // H031 wide pages light / dark (+ viewport-size captures): 3b, 4 (router answered), 5 finish.
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true, config: { port: '45989' } });
    const ctx = await context(browser, theme);
    trackRequests(ctx);
    const page = await ctx.newPage();
    await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
    await step(page, '3b', '&via=forward');
    check(`H031 ${theme} 3b: router-only lead line`, await page.isVisible('[data-3b-lead]'));
    check(`H031 ${theme} 3b: no outside value / PIN / new pairing on this step`, !(await page.isVisible('[data-outside-value]')) && !(await page.isVisible('[data-action="pairing-off"]')) && !(await page.isVisible('[data-pin-link]')));
    check(`H031 ${theme} 3b: makers' guides under item 3 (two routers)`, (await page.$$('[data-3b-double] [data-guide]')).length === 2);
    await h031Shot(page, `H031-step3b-${theme}`);
    await page.click('[data-next-4]');
    await page.waitForSelector('[data-remote-step="4"]');
    await page.waitForSelector('[data-wan-state="ok"]');
    check(`H031 ${theme} 4: router answer shown hidden (address and value)`, (await page.textContent('[data-wan-address] [data-address]')).trim() === MASK && (await page.textContent('[data-outside-value] [data-address]')).trim() === `${MASK}:45989`);
    check(`H031 ${theme} 4: order = network, value, PIN, new pairing, result`, await page.evaluate(() => [...document.querySelectorAll('[data-s4]')].map((e) => e.dataset.s4).join(',') === 'network,value,pin,pairing,result'));
    check(`H031 ${theme} 4: "주소가 바뀌면" and DDNS lines`, (await page.isVisible('[data-wan-changes]')) && (await page.isVisible('[data-ddns]')));
    await h031Shot(page, `H031-step4-forward-${theme}`);
    await page.click('[data-action="pairing-off"]');
    await page.waitForSelector('[data-action="pairing-on"]');
    await page.click('[data-result="ok"]');
    await page.click('[data-next-5]');
    await page.waitForSelector('[data-remote-step="5"]');
    const rows = await page.$$eval('[data-summary-row]', (trs) => trs.map((tr) => [tr.dataset.summaryRow, tr.querySelector('td').innerText.trim()]));
    check(`H031 ${theme} 5: summary = 포트 포워딩 / 6 rules / 됐어요 / 꺼짐`, JSON.stringify(rows) === JSON.stringify([['method', '포트 포워딩'], ['rules', '6개(TCP 45984, 45989, 46010 · UDP 45998, 45999, 46000)'], ['result', '됐어요'], ['pairing', '꺼짐(권장)']]), JSON.stringify(rows));
    check(`H031 ${theme} 5: advanced undo present and closed`, (await page.$eval('[data-advanced-revert]', (d) => !d.open)) && !(await page.isVisible('[data-changes]')));
    await h031Shot(page, `H031-step5-finish-${theme}`);
    await page.$eval('[data-advanced-revert]', (d) => (d.open = true));
    check(`H031 ${theme} 5: plain words in the change table`, (await page.textContent('[data-change="enable_pairing"]')).includes('꺼짐') && !(await page.textContent('[data-changes]')).match(/disabled|enabled/));
    if (theme === 'light') await h031Shot(page, 'H031-step5-finish-advanced-open-light', false);
    for (const st of ['0', '1', '2', '3a', '3b', '3c', '3d', '4', '5']) {
      await step(page, st);
      const keys = await visibleTextHasKeys(page);
      check(`H031 ${theme} step ${st}: no setting key name on screen`, keys.length === 0, JSON.stringify(keys));
      check(`H031 ${theme} step ${st}: addresses hidden`, await addressesMasked(page));
    }
    await ctx.close();
  }

  // H031 narrow (390 px) light / dark: 3b, 4 (typed value), 5.
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true, config: { port: '45989' }, net: { routerWan: { state: 'no_answer', kind: 'unknown' } } });
    const ctx = await context(browser, theme, { width: 390, height: 844 });
    trackRequests(ctx);
    const page = await ctx.newPage();
    await step(page, '3b', '&via=forward');
    await h031Shot(page, `H031-390-step3b-${theme}`);
    check(`H031 ${theme} 390px 3b: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await step(page, '4', '&via=forward');
    await page.waitForSelector('[data-wan-state="none"]');
    await page.fill('[data-field="outside-address"]', DOC);
    await page.waitForSelector('[data-manual-value]');
    check(`H031 ${theme} 390px 4: typed value hidden (●●●:45989)`, (await page.textContent('[data-manual-value] [data-address]')).trim() === `${MASK}:45989`);
    await h031Shot(page, `H031-390-step4-manual-${theme}`);
    check(`H031 ${theme} 390px 4: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await step(page, '5');
    await h031Shot(page, `H031-390-step5-${theme}`);
    check(`H031 ${theme} 390px 5: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await ctx.close();
  }

  {
    // H031 behaviour (light). Real mouse, touch (CDP touch events), keyboard; router states; typed address; requests.
    await mock({ reset: true, config: { port: '45989' } });
    const ctx = await context(browser, 'light', { width: 1366, height: 900 });
    trackRequests(ctx);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const page = await ctx.newPage();
    await step(page, '4', '&via=forward');
    await page.waitForSelector('[data-wan-state="ok"]');
    const calls1 = (await last()).routerWanCalls;
    check('H031 4: one router question on entering step 4', calls1 === 1, String(calls1));
    // F1 mouse, pressed near the left edge (the 0.3.0 failure spot)
    let h = await mouseHold(page, '[data-outside-value]', 'left');
    check('H031 F1 mouse: shown while pressed (150 ms)', h.during === `${DOC}:45989`, h.during);
    check('H031 F1 mouse: the button does not move when the value shows', h.sameSpot);
    check('H031 F1 mouse: still shown after dragging 80 px off the button', h.dragged === `${DOC}:45989`, h.dragged);
    await page.screenshot({ path: join(out, 'H031-step4-reveal-example-light.png'), fullPage: false });
    results.shots.push({ name: 'H031-step4-reveal-example-light', path: '/arbs/remote?step=4', file: 'H031-step4-reveal-example-light.png' });
    let after = await h.release();
    check('H031 F1 mouse: hidden after letting go', after === `${MASK}:45989`, after);
    for (const row of ['[data-wan-address]']) {
      h = await mouseHold(page, row, 'center');
      check(`H031 F1 mouse ${row}: shown while pressed`, h.during === DOC, h.during);
      after = await h.release();
      check(`H031 F1 mouse ${row}: hidden after letting go`, after === MASK, after);
    }
    // each row keeps its own state: pressing one does not show the other
    {
      const b = await page.locator('[data-wan-address] [data-reveal]').boundingBox();
      await page.mouse.move(b.x + 5, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(120);
      check('H031 F1: rows are independent', (await page.textContent('[data-outside-value] [data-address]')).trim() === `${MASK}:45989`);
      await page.mouse.up();
    }
    // right button: nothing shown, context menu blocked
    await page.evaluate(() => {
      window.__cm = [];
      window.addEventListener('contextmenu', (e) => window.__cm.push(e.defaultPrevented));
    });
    {
      const b = await page.locator('[data-outside-value] [data-reveal]').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(120);
      const r = (await page.textContent('[data-outside-value] [data-address]')).trim();
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(80);
      const cm = await page.evaluate(() => window.__cm);
      check('H031 F1 right button: not shown, context menu blocked', r === `${MASK}:45989` && cm.length >= 1 && cm.every(Boolean), `${r} ${JSON.stringify(cm)}`);
    }
    // keyboard: Space / Enter while held, other keys do nothing
    await page.focus('[data-outside-value] [data-reveal]');
    await page.keyboard.down(' ');
    await page.waitForTimeout(80);
    const kDown = (await page.textContent('[data-outside-value] [data-address]')).trim();
    await page.keyboard.press('Shift');
    const kShift = (await page.textContent('[data-outside-value] [data-address]')).trim();
    await page.keyboard.up(' ');
    await page.waitForTimeout(80);
    const kUp = (await page.textContent('[data-outside-value] [data-address]')).trim();
    check('H031 F1 keyboard Space: shown while held, other key keeps it, hidden on release', kDown === `${DOC}:45989` && kShift === kDown && kUp === `${MASK}:45989`, `${kDown} / ${kShift} / ${kUp}`);
    await page.keyboard.down('Enter');
    await page.waitForTimeout(80);
    const eDown = (await page.textContent('[data-outside-value] [data-address]')).trim();
    await page.keyboard.up('Enter');
    await page.waitForTimeout(80);
    check('H031 F1 keyboard Enter: shown while held, hidden on release', eDown === `${DOC}:45989` && (await page.textContent('[data-outside-value] [data-address]')).trim() === `${MASK}:45989`, eDown);
    // copy works while hidden
    await page.click('[data-outside-value] [data-copy]');
    await page.waitForTimeout(150);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('H031 4: copy gives the value for Moonlight (documentation example)', clip === `${DOC}:45989`, clip);
    // "다시 물어보기" asks once more
    await page.click('[data-action="wan-retry"]');
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-wan-state="ok"]');
    check('H031 4: "다시 물어보기" asks the router again', (await last()).routerWanCalls === calls1 + 1);
    await h031Shot(page, 'H031-step4-public-light', false);

    // router: private (two routers) and 100.64 (carrier) -> no value, guidance + typed input
    for (const [kind, name] of [
      ['private', 'private'],
      ['cgnat', 'cgnat'],
    ]) {
      await mock({ net: { routerWan: { state: 'ok', kind } } });
      await step(page, '4', '&via=forward');
      await page.waitForSelector('[data-wan-state="private"]');
      check(`H031 4 router ${name}: two-routers guidance, no value, typed input offered`, !(await page.isVisible('[data-outside-value]')) && (await page.isVisible('[data-manual]')) && (await page.isVisible('[data-go-3b]')));
      if (kind === 'private') await h031Shot(page, 'H031-step4-private-light', false);
    }
    // router gives nothing / older server (404): typed input
    for (const [patch, name] of [
      [{ routerWan: { state: 'no_router', kind: 'unknown' }, routerWanFail: false }, 'no-router'],
      [{ routerWanFail: true }, 'older-server-404'],
    ]) {
      await mock({ net: patch });
      await step(page, '4', '&via=forward');
      await page.waitForSelector('[data-wan-state="none"]');
      check(`H031 4 ${name}: "직접 넣기" shown`, (await page.isVisible('[data-manual]')) && !(await page.isVisible('[data-outside-value]')));
    }
    check('H031 4: outside check link hidden while its address is empty', !(await page.isVisible('[data-external-check]')));
    await page.fill('[data-field="outside-address"]', '192.168.217.43');
    check('H031 4 typed private address refused', (await page.getAttribute('[data-outside-error]', 'data-outside-error')) === 'private' && !(await page.isVisible('[data-manual-value]')));
    await page.fill('[data-field="outside-address"]', 'not an address');
    check('H031 4 typed text that is not an address refused', (await page.getAttribute('[data-outside-error]', 'data-outside-error')) === 'format');
    await page.fill('[data-field="outside-address"]', `http://${DOC}:1234/`);
    await page.waitForSelector('[data-manual-value]');
    check('H031 4 typed address -> value with this PC port (hidden), port replaced note', (await page.textContent('[data-manual-value] [data-address]')).trim() === `${MASK}:45989` && (await page.isVisible('[data-port-replaced]')));
    h = await mouseHold(page, '[data-manual-value]', 'left');
    check('H031 4 typed value: shown while pressed', h.during === `${DOC}:45989`, h.during);
    await page.screenshot({ path: join(out, 'H031-step4-manual-reveal-example-light.png'), fullPage: false });
    results.shots.push({ name: 'H031-step4-manual-reveal-example-light', path: '/arbs/remote?step=4', file: 'H031-step4-manual-reveal-example-light.png' });
    after = await h.release();
    check('H031 4 typed value: hidden after letting go', after === `${MASK}:45989`, after);
    await page.click('[data-manual-value] [data-copy]');
    await page.waitForTimeout(150);
    check('H031 4 typed value: copy', (await page.evaluate(() => navigator.clipboard.readText())) === `${DOC}:45989`);
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }) + location.href);
    check('H031 4: the typed address is not in storage or the address bar', !stored.includes('203.0.113'), stored.includes('203.0.113') ? 'found' : '');
    await h031Shot(page, 'H031-step4-manual-light', false);

    // Tailscale way: no router question, tailnet value
    await mock({ reset: true, config: { port: '45989' } });
    const before = (await last()).routerWanCalls;
    await step(page, '4', '&via=tailscale');
    await page.waitForTimeout(300);
    check('H031 4 Tailscale: no router question, tailnet value hidden', (await last()).routerWanCalls === before && (await page.textContent('[data-s4-tailnet] [data-address]')).trim() === `${MASK}:45989`);
    await h031Shot(page, 'H031-step4-tailscale-light', false);
    check('H031 4 PIN link goes to 새 기기 연결', (await page.getAttribute('[data-pin-link]', 'href')) === '/arbs/devices/pair');

    // touch: long press (CDP touch events) shows, no context menu, release hides
    const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR' });
    trackRequests(tctx);
    await tctx.route('https://api.github.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(releases) }));
    await tctx.route(/^https:\/\/(?!api\.github\.com)/, (route) => route.abort());
    const tp = await tctx.newPage();
    await step(tp, '4', '&via=forward');
    await tp.waitForSelector('[data-wan-state="ok"]');
    await tp.evaluate(() => {
      window.__cm = [];
      window.__sel = 0;
      window.addEventListener('contextmenu', (e) => window.__cm.push(e.defaultPrevented));
      document.addEventListener('selectionchange', () => (window.__sel += document.getSelection().toString().length));
    });
    const tb = tp.locator('[data-outside-value] [data-reveal]');
    await tb.scrollIntoViewIfNeeded();
    const tbox = await tb.boundingBox();
    const cdp = await tctx.newCDPSession(tp);
    const tx = tbox.x + 6;
    const ty = tbox.y + tbox.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
    await tp.waitForTimeout(150);
    const t150 = (await tp.textContent('[data-outside-value] [data-address]')).trim();
    await tp.waitForTimeout(650);
    const t800 = (await tp.textContent('[data-outside-value] [data-address]')).trim();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 40, y: ty + 10 }] });
    await tp.waitForTimeout(100);
    const tMove = (await tp.textContent('[data-outside-value] [data-address]')).trim();
    await tp.screenshot({ path: join(out, 'H031-390-step4-touch-hold-example-light.png'), fullPage: false });
    results.shots.push({ name: 'H031-390-step4-touch-hold-example-light', path: '/arbs/remote?step=4', file: 'H031-390-step4-touch-hold-example-light.png' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await tp.waitForTimeout(120);
    const tUp = (await tp.textContent('[data-outside-value] [data-address]')).trim();
    const tcm = await tp.evaluate(() => ({ cm: window.__cm, sel: window.__sel }));
    check('H031 F1 touch: shown while held (150 ms and 800 ms long press)', t150 === `${DOC}:45989` && t800 === `${DOC}:45989`, `${t150} / ${t800}`);
    check('H031 F1 touch: still shown when the finger slides', tMove === `${DOC}:45989`, tMove);
    check('H031 F1 touch: hidden after lifting the finger', tUp === `${MASK}:45989`, tUp);
    check('H031 F1 touch: no context menu (blocked if raised), no text selected', tcm.cm.every(Boolean) && tcm.sel === 0, JSON.stringify(tcm));
    results.h031.touch = { t150: t150 === `${DOC}:45989`, t800: t800 === `${DOC}:45989`, tMove: tMove === `${DOC}:45989`, hiddenAfter: tUp === `${MASK}:45989`, contextmenu: tcm.cm };
    await tctx.close();

    // finish step: nothing changed -> no advanced box; prev_port -> open
    await mock({ reset: true });
    const fctx = await context(browser, 'light');
    trackRequests(fctx);
    const fp = await fctx.newPage();
    await fp.goto(`${base}/arbs/remote?step=5`);
    await fp.waitForSelector('[data-remote-step="5"]');
    await fp.evaluate(() => sessionStorage.clear());
    await fp.reload();
    await fp.waitForSelector('[data-remote-step="5"]');
    await fp.waitForTimeout(250);
    check('H031 5 nothing changed: no "바꾼 설정 되돌리기" box', !(await fp.$('[data-advanced-revert]')));
    check('H031 5 nothing chosen: method "아직 고르지 않음", result "아직 확인하지 않음"', (await fp.textContent('[data-summary-row="method"] td')).includes('아직 고르지 않음') && (await fp.textContent('[data-summary-row="result"] td')).includes('아직 확인하지 않음'));
    check('H031 5 new pairing on: advice + link to step 4', await fp.isVisible('[data-pairing-advice] [data-go-4]'));
    await h031Shot(fp, 'H031-step5-nothing-changed-light', false);
    await mock({ reset: true, config: { port: '45989' } });
    await fp.goto(`${base}/arbs/remote?step=5&prev_port=47989`);
    await fp.waitForSelector('[data-remote-step="5"]');
    await fp.waitForTimeout(300);
    check('H031 5 after a port change link: advanced box open with the port row', (await fp.$eval('[data-advanced-revert]', (d) => d.open)) && (await fp.isVisible('[data-change="port"]')));
    await fctx.close();

    // ARBS icon on the ARBS WebUI: top bar logo, favicon links, login logo
    await mock({ reset: true });
    const ictx = await context(browser, 'light');
    const ip = await ictx.newPage();
    await ip.goto(`${base}/arbs/`);
    await ip.waitForSelector('.page');
    await ip.waitForTimeout(300);
    const logo = await ip.$eval('.topbar__brand img', (img) => ({ src: img.getAttribute('src'), w: img.naturalWidth }));
    check('H031 icon: top bar logo = /arbs/images/arbs-logo.svg and loads', logo.src === '/arbs/images/arbs-logo.svg' && logo.w > 0, JSON.stringify(logo));
    const links = await ip.$$eval('link[rel="icon"], link[rel="apple-touch-icon"]', (ls) => ls.map((l) => l.getAttribute('href')));
    check('H031 icon: favicon links (ico, svg, apple-touch)', JSON.stringify(links) === JSON.stringify(['/arbs/images/favicon.ico', '/arbs/images/icon.svg', '/arbs/images/apple-touch-icon.png']), JSON.stringify(links));
    for (const href of links) {
      const res = await ip.request.get(`${base}${href}`);
      const r = [res.status(), res.headers()['content-type'], (await res.body()).length];
      check(`H031 icon: ${href} served`, r[0] === 200 && r[2] > 0, JSON.stringify(r));
    }
    for (const theme of ['light', 'dark']) {
      await ip.evaluate((t) => localStorage.setItem('arbs.theme', t), theme);
      await ip.reload();
      await ip.waitForSelector('.page');
      await ip.waitForTimeout(250);
      await ip.screenshot({ path: join(out, `H031-icon-topbar-${theme}.png`), clip: { x: 0, y: 0, width: 520, height: 64 } });
      results.shots.push({ name: `H031-icon-topbar-${theme}`, path: '/arbs/', file: `H031-icon-topbar-${theme}.png` });
    }
    await mock({ auth: { authenticated: false, credentials_configured: true, login_required: true } });
    for (const theme of ['light', 'dark']) {
      await ip.evaluate((t) => localStorage.setItem('arbs.theme', t), theme);
      await ip.goto(`${base}/arbs/`);
      await ip.waitForSelector('[data-login-logo]');
      await ip.waitForTimeout(300);
      const ll = await ip.$eval('[data-login-logo]', (img) => img.naturalWidth);
      check(`H031 icon ${theme}: login cover shows the ARBS logo`, ll > 0, String(ll));
      await ip.screenshot({ path: join(out, `H031-icon-login-${theme}.png`), fullPage: false });
      results.shots.push({ name: `H031-icon-login-${theme}`, path: '/arbs/', file: `H031-icon-login-${theme}.png` });
    }
    await mock({ reset: true });
    // favicon sheet: the files the three web screens use, at 16 / 32 / 48 and x4
    await ip.setContent(`<!doctype html><body style="margin:0;padding:12px;font:13px sans-serif;display:grid;grid-template-columns:repeat(2,auto);gap:12px 32px;background:#fff">
      ${[
        ['ARBS WebUI favicon.ico', `${base}/arbs/images/favicon.ico`],
        ['ARBS WebUI icon.svg', `${base}/arbs/images/icon.svg`],
        ['ARBS WebUI apple-touch-icon.png', `${base}/arbs/images/apple-touch-icon.png`],
        ['v1 / v2 arbs-favicon.ico (/images/)', `${base}/images/arbs-favicon.ico`],
        ['v1 / v2 logo arbs-logo-45.png (/images/)', `${base}/images/arbs-logo-45.png`],
      ]
        .map(([label, src]) => `<div>${label}</div><div style="display:flex;gap:10px;align-items:end">${[16, 32, 48].map((s) => `<img src="${src}" width="${s}" height="${s}">`).join('')}<img src="${src}" width="64" height="64" style="image-rendering:pixelated"><span style="background:#1c1917;padding:6px;display:flex;gap:10px">${[16, 32].map((s) => `<img src="${src}" width="${s}" height="${s}">`).join('')}</span></div>`)
        .join('')}</body>`);
    await ip
      .waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 })
      .catch(() => undefined);
    const broken = await ip.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
    check('H031 icon: every favicon / logo file in the sheet loads', broken.length === 0, JSON.stringify(broken));
    await ip.screenshot({ path: join(out, 'H031-icon-favicons.png'), fullPage: true });
    results.shots.push({ name: 'H031-icon-favicons', path: '(sheet)', file: 'H031-icon-favicons.png' });
    await ictx.close();
    await ctx.close();
    const outside = results.h031.requests.filter((h) => h !== 'api.github.com');
    check('H031 D6: no request to any outside host from the remote access page (api.github.com = update check only)', outside.length === 0, JSON.stringify([...new Set(results.h031.requests)]));
  }


  // NET2 narrow (390 px): wizard pages and the memo-3 drawer + save bar case.
  results.net2.drawer = {};
  for (const theme of ['light', 'dark']) {
    await mock({ reset: true });
    let ctx = await context(browser, theme, { width: 390, height: 844 });
    let page = await ctx.newPage();
    for (const s of ['1', '3a', '3b', '3d']) {
      await shot(page, `NET2-390-step${s}-${theme}`, `/arbs/remote?step=${s}`, (p) => p.waitForSelector(`[data-remote-step="${s}"]`));
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`NET2 ${theme} 390px step ${s}: no sideways scroll`, wide <= 390, String(wide));
      check(`NET2 ${theme} 390px step ${s}: addresses hidden`, await addressesMasked(page));
    }
    await ctx.close();

    // Drawer open while a setting is not saved yet (the save bar shows "저장 안 한 설정").
    await mock({ reset: true });
    ctx = await context(browser, theme, { width: 390, height: 844 });
    page = await ctx.newPage();
    await page.goto(`${base}/arbs/controller`);
    await page.waitForSelector('.page');
    await page.waitForTimeout(300);
    await page.locator('details[data-advanced]').evaluate((d) => (d.open = true));
    await page.check('[data-setting="arbs_trigger_status_off"]');
    await page.click('.topbar__menu');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(out, `NET2-drawer-savebar-390-${theme}.png`), fullPage: false });
    results.shots.push({ name: `NET2-drawer-savebar-390-${theme}`, path: '/arbs/controller', file: `NET2-drawer-savebar-390-${theme}.png` });
    const m = await page.evaluate(async () => {
      const bar = document.querySelector('.savebar').getBoundingClientRect();
      const links = [...document.querySelectorAll('#arbs-nav a.nav__link')];
      const coveredAtTop = links.filter((a) => {
        const r = a.getBoundingClientRect();
        return r.bottom > bar.top && r.top < window.innerHeight;
      }).length;
      // Keyboard: Tab to the last menu item scrolls it into view; it must not end up under the fixed save bar.
      const lastLink = links[links.length - 1];
      lastLink.focus();
      await new Promise((r) => setTimeout(r, 100));
      const r = lastLink.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        saveBarHeight: Math.round(bar.height),
        shellPadding: getComputedStyle(document.querySelector('.shell')).paddingBottom,
        coveredAtTop,
        lastFocusedVisible: Boolean(hit && lastLink.contains(hit)),
        lastBottom: Math.round(r.bottom),
        barTop: Math.round(document.querySelector('.savebar').getBoundingClientRect().top),
      };
    });
    results.net2.drawer[theme] = m;
    check(`NET2 ${theme} 390px drawer: focused last menu item is not under the save bar`, m.lastFocusedVisible, JSON.stringify(m));
    check(`NET2 ${theme} 390px drawer: unsaved state still shown`, (await page.textContent('.savebar__state')).includes('저장 안 한 설정'));
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
