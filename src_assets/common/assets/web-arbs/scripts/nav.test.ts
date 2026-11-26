// ARBS-H 0.2.1 (H021): side menu structure. Group titles are headings (not links), items are links
// in a list under them; "통계" is in the 관리 group.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isCurrent, NAV_GROUPS } from '../logic/nav.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('four groups, each with a title and at least one item; stats in "manage"', () => {
  assert.deepEqual(
    NAV_GROUPS.map((g) => g.id),
    ['home', 'connect', 'settings', 'manage'],
  );
  for (const g of NAV_GROUPS) {
    assert.match(g.label, /^nav\.group_/, g.id);
    assert.ok(g.items.length > 0, g.id);
  }
  const manage = NAV_GROUPS.find((g) => g.id === 'manage')!;
  assert.deepEqual(
    manage.items.map((i) => i.to),
    ['/stats', '/troubleshoot', '/account'],
  );
  const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
  assert.equal(new Set(all).size, all.length);
  for (const to of all) assert.doesNotMatch(to, /stream/i, 'no browser stream page');
});

test('every menu path is a route and passes the address guard', async () => {
  const router = readFileSync(join(root, 'router.ts'), 'utf8');
  const guards = readFileSync(join(root, 'logic/guards.ts'), 'utf8');
  for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
    assert.match(router, new RegExp(`path: '${item.to.replace('/', '\\/')}'`), item.to);
    assert.ok(guards.includes(`'${item.to}'`), `${item.to} in KNOWN_TOP`);
  }
});

test('NavMenu: title = heading inside role=group (aria-labelledby), items = links in a list', () => {
  const nav = readFileSync(join(root, 'components/NavMenu.vue'), 'utf8');
  assert.match(nav, /role="group"/);
  assert.match(nav, /:aria-labelledby="`nav-group-\$\{group\.id\}`"/);
  assert.match(nav, /<h2 :id="`nav-group-\$\{group\.id\}`" class="nav__label"/);
  assert.match(nav, /<ul class="nav__items">\s*<li v-for="item in group\.items"/);
  assert.match(nav, /<RouterLink[\s\S]*class="nav__link"/);
  // The title is not a link or a button.
  const heading = nav.slice(nav.indexOf('<h2'), nav.indexOf('</h2>'));
  assert.doesNotMatch(heading, /RouterLink|<a |<button|@click|tabindex/);
});

test('styles: title has no pointer and no hover rule; items are indented and keep hover/current', () => {
  const css = readFileSync(join(root, 'styles/base.css'), 'utf8');
  const label = /\.nav__label \{([^}]*)\}/.exec(css)![1]!;
  assert.match(label, /cursor: default/);
  assert.match(label, /color: var\(--arbs-muted\)/);
  assert.doesNotMatch(label, /opacity/);
  assert.doesNotMatch(css, /\.nav__label:hover/);
  const link = /\.nav__link \{([^}]*)\}/.exec(css)![1]!;
  const left = /padding: [\d.]+rem [\d.]+rem [\d.]+rem ([\d.]+)rem/.exec(link);
  assert.ok(left && Number(left[1]) >= 1, 'item indented by at least 1rem');
  assert.match(css, /\.nav__link:hover \{/);
  assert.match(css, /\.nav__link--current \{/);
});

test('current page match (exact for "/", prefix for the others)', () => {
  assert.equal(isCurrent('/', '/'), true);
  assert.equal(isCurrent('/stats', '/'), false);
  assert.equal(isCurrent('/stats', '/stats'), true);
  assert.equal(isCurrent('/apps/abc', '/apps'), true);
  assert.equal(isCurrent('/appsx', '/apps'), false);
});
