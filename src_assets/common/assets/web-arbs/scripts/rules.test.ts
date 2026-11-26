// ARBS-H UI1b: D-UI-3 disable rules R1-R14 (docs/analysis/UI1b.md §3).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appHapticsReason,
  appNameReason,
  appSelectReason,
  authReason,
  controllerOffReason,
  crashReason,
  deviceSelectReason,
  disconnectReason,
  dualSenseReason,
  firstReason,
  DUALSENSE_GAMEPADS,
  historyToggleReason,
  isWindows,
  makesDualSense,
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

test('R6 gamepad input off; R7 (H021 plan A) trigger status and gain only where the pad becomes a DualSense', () => {
  assert.equal(controllerOffReason({ controller: false, gamepad: 'usbip_ds5' }), 'reason.controller_off');
  assert.equal(dualSenseReason({ controller: false, gamepad: 'usbip_ds5' }), 'reason.controller_off');
  // EA-H021-R-03: usbip DualSense is built for these (APEX = PlayStation pad + usbip-win2).
  assert.deepEqual([...DUALSENSE_GAMEPADS], ['usbip_ds5', 'auto', 'vhf', 'vhf_ds5', 'vhf_steam']);
  for (const gamepad of ['usbip_ds5', 'auto', 'vhf', 'vhf_ds5', 'vhf_steam']) {
    assert.equal(makesDualSense(gamepad), true, gamepad);
    assert.equal(dualSenseReason({ controller: true, gamepad }), null, gamepad);
  }
  for (const gamepad of ['x360', 'ds4', 'vhf_xbox', 'vhf_xbox_one', 'vhf_ds4', 'vhf_switch']) {
    assert.equal(makesDualSense(gamepad), false, gamepad);
    assert.equal(dualSenseReason({ controller: true, gamepad }), 'reason.need_dualsense', gamepad);
  }
  // A name the server does not know is ignored there (default auto stays), so it counts as auto.
  assert.equal(dualSenseReason({ controller: true, gamepad: 'USBIP_DS5' }), null);
  assert.equal(dualSenseReason({ controller: true, gamepad: 'bogus' }), null);
});

test('per-app HD haptics only needs gamepad input on (any type); history switch waits for the stream end', () => {
  for (const gamepad of ['usbip_ds5', 'x360', 'ds4', 'vhf_xbox', 'auto']) {
    assert.equal(appHapticsReason({ controller: true, gamepad }), null, gamepad);
    assert.equal(appHapticsReason({ controller: false, gamepad }), 'reason.controller_off', gamepad);
  }
  assert.equal(historyToggleReason(true), 'reason.streaming_now');
  assert.equal(historyToggleReason(false), null);
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
