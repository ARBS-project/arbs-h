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
