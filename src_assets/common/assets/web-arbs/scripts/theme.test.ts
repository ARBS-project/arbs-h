// ARBS-H UI1b: theme saved in localStorage "arbs.theme" (try/catch) + the pre-load boot script.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { pickLocale } from '../logic/lang.ts';
import { DEFAULT_THEME, readTheme, resolveTheme, THEME_KEY, writeTheme } from '../logic/theme.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}
const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

test('key name and default', () => {
  assert.equal(THEME_KEY, 'arbs.theme');
  assert.equal(DEFAULT_THEME, 'system');
  assert.equal(readTheme(memory()), 'system');
  assert.equal(readTheme(null), 'system');
});

test('saved values round-trip, bad values fall back', () => {
  const s = memory();
  for (const v of ['light', 'dark', 'system'] as const) {
    assert.equal(writeTheme(s, v), true);
    assert.equal(s.data.get('arbs.theme'), v);
    assert.equal(readTheme(s), v);
  }
  assert.equal(readTheme(memory({ 'arbs.theme': 'auto' })), 'system');
  assert.equal(readTheme(memory({ 'arbs.theme': 'DARK' })), 'system');
  assert.equal(writeTheme(s, 'sepia' as never), false);
});

test('disabled storage never throws', () => {
  assert.equal(readTheme(throwing), 'system');
  assert.equal(writeTheme(throwing, 'dark'), false);
});

test('resolve system preference', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

function boot(storage: unknown, prefersDark: boolean): string | undefined {
  const code = readFileSync(new URL('../public/assets/theme-boot.js', import.meta.url), 'utf8');
  const attrs: Record<string, string> = {};
  runInNewContext(code, {
    window: {
      localStorage: storage,
      matchMedia: (q: string) => ({ matches: q.includes('dark') && prefersDark }),
    },
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  });
  return attrs['data-theme'];
}

test('theme-boot.js applies the same rule before the app loads', () => {
  assert.equal(boot(memory({ 'arbs.theme': 'dark' }), false), 'dark');
  assert.equal(boot(memory({ 'arbs.theme': 'light' }), true), 'light');
  assert.equal(boot(memory({ 'arbs.theme': 'system' }), true), 'dark');
  assert.equal(boot(memory(), false), 'light');
  assert.equal(boot(throwing, true), 'dark');
});

test('language: Korean by default, English when chosen or server locale is English', () => {
  assert.equal(pickLocale(null, ''), 'ko');
  assert.equal(pickLocale(null, 'ko'), 'ko');
  assert.equal(pickLocale(null, 'de'), 'ko');
  assert.equal(pickLocale(null, 'en'), 'en');
  assert.equal(pickLocale(null, 'en_GB'), 'en');
  assert.equal(pickLocale('ko', 'en'), 'ko');
  assert.equal(pickLocale('en', 'ko'), 'en');
});
