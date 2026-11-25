// ARBS-H UI1b: D-UI-3 disable rules R1-R14 (docs/analysis/UI1b.md §3).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appNameReason,
  appSelectReason,
  authReason,
  controllerOffReason,
  crashReason,
  deviceSelectReason,
  disconnectReason,
  dualSenseReason,
  firstReason,
  gamepadWarning,
  isWindows,
  offlineReason,
  pairReason,
  passwordReason,
  runningReason,
  searchReason,
  snapshotReason,
  unchangedReason,
} from '../logic/rules.ts';

test('R1 sign-in / first account', () => {
  assert.equal(authReason({ credentials_configured: false, login_required: true }), 'reason.need_account');
  assert.equal(authReason({ credentials_configured: true, login_required: true }), 'reason.need_login');
  assert.equal(authReason({ credentials_configured: true, login_required: false }), null);
});

test('R2 offline blocks actions', () => {
  assert.equal(offlineReason(false), 'reason.offline');
  assert.equal(offlineReason(true), null);
  assert.equal(firstReason(offlineReason(false), deviceSelectReason(null)), 'reason.offline');
});

test('R3 device must be chosen; R4 disconnect needs a connected device', () => {
  assert.equal(deviceSelectReason(null), 'reason.pick_device');
  assert.equal(deviceSelectReason(undefined), 'reason.pick_device');
  assert.equal(deviceSelectReason({ uuid: 'a', connected: false }), null);
  assert.equal(disconnectReason(null), 'reason.pick_device');
  assert.equal(disconnectReason({ uuid: 'a', connected: false }), 'reason.device_offline');
  assert.equal(disconnectReason({ uuid: 'a', connected: true }), null);
});

test('R5 app must be chosen', () => {
  assert.equal(appSelectReason(false), 'reason.pick_app');
  assert.equal(appSelectReason(true), null);
});

test('R6 gamepad input off; R7 gamepad must be usbip_ds5', () => {
  assert.equal(controllerOffReason({ controller: false, gamepad: 'usbip_ds5' }), 'reason.controller_off');
  assert.equal(dualSenseReason({ controller: false, gamepad: 'usbip_ds5' }), 'reason.controller_off');
  for (const gamepad of ['auto', 'x360', 'ds4', 'vhf_ds5', 'USBIP_DS5', '']) {
    assert.equal(dualSenseReason({ controller: true, gamepad }), 'reason.need_usbip_ds5', gamepad);
    assert.equal(gamepadWarning({ controller: true, gamepad }), true, gamepad);
  }
  assert.equal(dualSenseReason({ controller: true, gamepad: 'usbip_ds5' }), null);
  assert.equal(gamepadWarning({ controller: true, gamepad: 'usbip_ds5' }), false);
  assert.equal(gamepadWarning({ controller: false, gamepad: 'x360' }), false);
});

test('R8 nothing running', () => {
  assert.equal(runningReason(null), 'reason.nothing_running');
  assert.equal(runningReason({ appRunning: false, activeSessions: 0 }), 'reason.nothing_running');
  assert.equal(runningReason({ appRunning: true, activeSessions: 0 }), null);
  assert.equal(runningReason({ appRunning: false, activeSessions: 1 }), null);
});

test('R9 snapshot, R10 crash dump, R11 unchanged', () => {
  assert.equal(snapshotReason(null), 'reason.no_snapshot');
  assert.equal(snapshotReason({ exists: false }), 'reason.no_snapshot');
  assert.equal(snapshotReason({ exists: true }), null);
  assert.equal(crashReason(0), 'reason.no_crash');
  assert.equal(crashReason(2), null);
  assert.equal(unchangedReason(0), 'reason.no_changes');
  assert.equal(unchangedReason(1), null);
});

test('R12 incomplete forms', () => {
  assert.equal(pairReason('', '1234'), 'reason.need_device_name');
  assert.equal(pairReason('Phone', ''), 'reason.need_pin');
  assert.equal(pairReason('Phone', '12345'), 'reason.need_pin');
  assert.equal(pairReason('Phone', '12a'), 'reason.need_pin');
  assert.equal(pairReason('Phone', '7'), null);
  assert.equal(passwordReason({ newUsername: '', newPassword: 'a', confirmPassword: 'a' }), 'reason.need_username');
  assert.equal(passwordReason({ newUsername: 'u', newPassword: '', confirmPassword: '' }), 'reason.need_password');
  assert.equal(passwordReason({ newUsername: 'u', newPassword: 'a', confirmPassword: 'b' }), 'reason.password_mismatch');
  assert.equal(passwordReason({ newUsername: 'u', newPassword: 'a', confirmPassword: 'a' }), null);
  assert.equal(appNameReason('  '), 'reason.need_app_name');
  assert.equal(appNameReason('Steam'), null);
});

test('R13 search text, R14 Windows only', () => {
  assert.equal(searchReason('', 0), 'reason.need_search');
  assert.equal(searchReason('x', 0), 'reason.no_match');
  assert.equal(searchReason('x', 3), null);
  assert.equal(isWindows('windows'), true);
  assert.equal(isWindows('linux'), false);
  assert.equal(isWindows(undefined), false);
});
