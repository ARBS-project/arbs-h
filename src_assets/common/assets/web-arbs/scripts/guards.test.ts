// ARBS-H UI1b: direct addresses go back to the upper page (D-UI-3).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guardRoute } from '../logic/guards.ts';

const base = { signedIn: true, deviceIds: ['dev-1'], appIds: ['app-1'] };

test('top pages always open', () => {
  for (const path of ['/', '/devices', '/controller', '/display', '/apps', '/remote', '/remote/', '/troubleshoot', '/account', '/apps/']) {
    assert.equal(guardRoute({ ...base, path }), null, path);
    assert.equal(guardRoute({ ...base, signedIn: false, path }), null, path);
  }
});

test('unknown device or app uuid goes back to the list', () => {
  assert.deepEqual(guardRoute({ ...base, path: '/devices/nope' }), { redirect: '/devices', notice: 'missing_device' });
  assert.deepEqual(guardRoute({ ...base, path: '/apps/nope' }), { redirect: '/apps', notice: 'missing_app' });
  assert.equal(guardRoute({ ...base, path: '/devices/dev-1' }), null);
  assert.equal(guardRoute({ ...base, path: '/apps/app-1' }), null);
  assert.equal(guardRoute({ ...base, path: '/devices/dev%2D1' }), null);
});

test('list could not be read: treat as missing', () => {
  assert.deepEqual(guardRoute({ ...base, deviceIds: null, path: '/devices/dev-1' }), {
    redirect: '/devices',
    notice: 'missing_device',
  });
  assert.deepEqual(guardRoute({ ...base, appIds: null, path: '/apps/app-1' }), { redirect: '/apps', notice: 'missing_app' });
});

test('sub pages need sign-in', () => {
  const out = { ...base, signedIn: false };
  assert.deepEqual(guardRoute({ ...out, path: '/devices/pair' }), { redirect: '/devices', notice: 'sign_in_first' });
  assert.deepEqual(guardRoute({ ...out, path: '/apps/new' }), { redirect: '/apps', notice: 'sign_in_first' });
  assert.deepEqual(guardRoute({ ...out, path: '/devices/dev-1' }), { redirect: '/devices', notice: 'sign_in_first' });
  assert.equal(guardRoute({ ...base, path: '/devices/pair' }), null);
  assert.equal(guardRoute({ ...base, path: '/apps/new' }), null);
});

test('anything else goes to status (no browser stream page)', () => {
  for (const path of ['/stream', '/settings', '/devices/a/b', '/x']) {
    assert.deepEqual(guardRoute({ ...base, path }), { redirect: '/', notice: 'not_found' }, path);
  }
});
