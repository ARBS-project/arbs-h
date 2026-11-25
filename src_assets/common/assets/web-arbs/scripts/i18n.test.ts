// ARBS-H UI1b: Korean and English catalogs have the same keys and cover every key the screens use.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ko = JSON.parse(readFileSync(join(root, 'locales/ko.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'));

function flat(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') Object.assign(out, flat(v as Record<string, unknown>, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}
const K = flat(ko);
const E = flat(en);

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'scripts'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

test('same keys in ko and en, no empty text', () => {
  assert.deepEqual(Object.keys(K).sort(), Object.keys(E).sort());
  for (const [k, v] of Object.entries({ ...K, ...E })) assert.ok(v.trim(), k);
});

test('placeholders match between languages', () => {
  for (const key of Object.keys(K)) {
    const a = (K[key]!.match(/\{\w+\}/g) ?? []).sort();
    const b = (E[key]!.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(a, b, key);
  }
});

test('no vue-i18n special characters that would break a message', () => {
  for (const [k, v] of Object.entries({ ...K, ...E })) assert.doesNotMatch(v, /[@|$]/, k);
});

test('every literal key used by the screens and rules exists', () => {
  const used = new Set<string>();
  for (const file of files(root, /\.(vue|ts)$/)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([a-z_0-9]+\.[a-z_0-9.]+)'/g)) used.add(m[1]!);
    for (const m of text.matchAll(/'((?:reason|save|guard|status|controller|account|display)\.[a-z_0-9]+)'/g)) used.add(m[1]!);
  }
  assert.ok(used.size > 150, `found ${used.size}`);
  for (const key of used) assert.ok(key in K, `missing ${key}`);
});

test('dynamic key families are complete', () => {
  const families: Record<string, string[]> = {
    theme: ['light', 'dark', 'system'],
    'controller.trigger_': ['h2b', 'enabled', 'disabled'],
    'display.mode_': ['per_client', 'shared', 'disabled'],
    'display.resolution_': ['auto', 'manual', 'disabled'],
    'display.done_': ['terminate', 'reset', 'capture', 'delete'],
    'devices.status_': ['streaming', 'blocked', 'active', 'never_seen'],
    'apps.badge_': ['playnite', 'steam', 'lutris', 'custom', 'managed'],
    'apps.system_': ['desktop', 'monitor', 'input'],
    'apps.cover_': ['searching', 'none', 'failed'],
    'status.readiness_': ['ready', 'attention', 'streaming', 'unknown'],
    'trouble.start_': ['automatic', 'manual', 'disabled', 'unknown'],
    'trouble.source_': ['sunshine', 'display_helper', 'wgc'],
    'trouble.sev_': ['all', 'error', 'warning', 'info', 'debug'],
    'account.default_': ['arbs', 'classic', 'v2'],
    'guard.': ['missing_device', 'missing_app', 'sign_in_first', 'not_found'],
    'perm.': ['list', 'view', 'launch', 'clipboard_set', 'clipboard_read', 'server_cmd', 'input_controller', 'input_touch', 'input_pen', 'input_mouse', 'input_kbd'],
    'gamepad.': ['usbip_ds5', 'auto', 'x360', 'ds4', 'vhf', 'vhf_xbox', 'vhf_xbox_one', 'vhf_ds4', 'vhf_ds5', 'vhf_switch', 'vhf_steam'],
  };
  for (const [prefix, values] of Object.entries(families)) {
    for (const v of values) {
      const key = prefix === 'theme' ? `theme.${v}` : `${prefix}${v}`;
      assert.ok(key in K, `missing ${key}`);
    }
  }
});

test('button says "ARBS-H 다시 시작", never "Restart Vibepollo"', () => {
  assert.equal(K['common.restart'], 'ARBS-H 다시 시작');
  assert.equal(E['common.restart'], 'Restart ARBS-H');
  for (const v of [...Object.values(K), ...Object.values(E)]) assert.doesNotMatch(v, /Vibepollo 다시|Restart Vibepollo/);
});
