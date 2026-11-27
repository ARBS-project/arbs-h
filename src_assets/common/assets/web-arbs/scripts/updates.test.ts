// ARBS-H UI1b: the copied update check finds v0.2.0 from 0.1.3 (same rules as the v2 UI).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { windowsSetupAsset } from '../utils/repo.ts';
import { dismissedUpdate, dismissUpdate, selectAvailableUpdate, type UpdateRelease } from '../utils/updates.ts';

function release(tag: string, extra: Partial<UpdateRelease> = {}, asset = windowsSetupAsset(tag)): UpdateRelease {
  return { tag_name: tag, draft: false, prerelease: false, assets: [{ name: asset, state: 'uploaded', size: 100 }], ...extra };
}

test('0.1.3 sees v0.2.0 with arbs-h-0.2.0-setup.exe', () => {
  assert.equal(windowsSetupAsset('v0.2.0'), 'arbs-h-0.2.0-setup.exe');
  const found = selectAvailableUpdate('0.1.3', [release('v0.1.3'), release('v0.2.0')], false);
  assert.equal(found?.tag.replace(/^v/, ''), '0.2.0');
});

test('H021: 0.2.0 sees v0.2.1 with arbs-h-0.2.1-setup.exe; 0.2.1 sees nothing newer', () => {
  assert.equal(windowsSetupAsset('v0.2.1'), 'arbs-h-0.2.1-setup.exe');
  const list = [release('v0.1.3'), release('v0.2.0'), release('v0.2.1')];
  assert.equal(selectAvailableUpdate('0.2.0', list, false)?.tag.replace(/^v/, ''), '0.2.1');
  assert.equal(selectAvailableUpdate('0.1.3', list, false)?.tag.replace(/^v/, ''), '0.2.1');
  assert.equal(selectAvailableUpdate('0.2.1', list, false), null);
  assert.equal(selectAvailableUpdate('0.2.0', [release('v0.2.1', {}, 'arbs-h-0.2.0-setup.exe')], false), null);
});

test('H022: 0.2.1 sees v0.2.2 with arbs-h-0.2.2-setup.exe; 0.2.2 sees nothing newer', () => {
  assert.equal(windowsSetupAsset('v0.2.2'), 'arbs-h-0.2.2-setup.exe');
  const list = [release('v0.2.0'), release('v0.2.1'), release('v0.2.2')];
  assert.equal(selectAvailableUpdate('0.2.1', list, false)?.tag.replace(/^v/, ''), '0.2.2');
  assert.equal(selectAvailableUpdate('0.2.0', list, false)?.tag.replace(/^v/, ''), '0.2.2');
  assert.equal(selectAvailableUpdate('0.2.2', list, false), null);
  // v0.2.2 carrying only the old asset name is not offered.
  assert.equal(selectAvailableUpdate('0.2.1', [release('v0.2.2', {}, 'arbs-h-0.2.1-setup.exe')], false), null);
  assert.equal(selectAvailableUpdate('0.2.1', [release('v0.2.2', { draft: true })], false), null);
  assert.equal(selectAvailableUpdate('0.2.1', [release('v0.2.2', { prerelease: true })], false), null);
});

test('NET2: 0.2.2 sees v0.3.0 with arbs-h-0.3.0-setup.exe; 0.3.0 sees nothing newer', () => {
  assert.equal(windowsSetupAsset('v0.3.0'), 'arbs-h-0.3.0-setup.exe');
  const list = [release('v0.2.1'), release('v0.2.2'), release('v0.3.0')];
  assert.equal(selectAvailableUpdate('0.2.2', list, false)?.tag.replace(/^v/, ''), '0.3.0');
  assert.equal(selectAvailableUpdate('0.2.1', list, false)?.tag.replace(/^v/, ''), '0.3.0');
  assert.equal(selectAvailableUpdate('0.3.0', list, false), null);
  assert.equal(selectAvailableUpdate('0.2.2', [release('v0.3.0', {}, 'arbs-h-0.2.2-setup.exe')], false), null);
  assert.equal(selectAvailableUpdate('0.2.2', [release('v0.3.0', { draft: true })], false), null);
  assert.equal(selectAvailableUpdate('0.2.2', [release('v0.3.0', { prerelease: true })], false), null);
});

test('H031: 0.3.0 sees v0.3.1 with arbs-h-0.3.1-setup.exe; 0.3.1 sees nothing newer', () => {
  assert.equal(windowsSetupAsset('v0.3.1'), 'arbs-h-0.3.1-setup.exe');
  const list = [release('v0.2.2'), release('v0.3.0'), release('v0.3.1')];
  assert.equal(selectAvailableUpdate('0.3.0', list, false)?.tag.replace(/^v/, ''), '0.3.1');
  assert.equal(selectAvailableUpdate('0.2.2', list, false)?.tag.replace(/^v/, ''), '0.3.1');
  assert.equal(selectAvailableUpdate('0.3.1', list, false), null);
  assert.equal(selectAvailableUpdate('0.3.0', [release('v0.3.1', {}, 'arbs-h-0.3.0-setup.exe')], false), null);
  assert.equal(selectAvailableUpdate('0.3.0', [release('v0.3.1', { draft: true })], false), null);
});

test('draft, prerelease (notify off), wrong or empty asset are skipped', () => {
  assert.equal(selectAvailableUpdate('0.1.3', [release('v0.2.0', { draft: true })], false), null);
  assert.equal(selectAvailableUpdate('0.1.3', [release('v0.2.0', { prerelease: true })], false), null);
  assert.equal(selectAvailableUpdate('0.1.3', [release('v0.2.0', {}, 'ARBS-H-0.2.0-setup.exe')], false), null);
  assert.equal(
    selectAvailableUpdate('0.1.3', [{ ...release('v0.2.0'), assets: [{ name: 'arbs-h-0.2.0-setup.exe', state: 'uploaded', size: 0 }] }], false),
    null,
  );
  assert.equal(selectAvailableUpdate('0.2.0', [release('v0.2.0')], false), null);
});

test('dismissed banner key is shared with the v2 UI', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  dismissUpdate(storage, 'v0.2.0');
  assert.equal(dismissedUpdate(storage, 'v0.2.0'), true);
  assert.ok(data.has('arbs-h-dismissed-updates'));
});
