// ARBS-H UI1b: GET /api/config reading and PATCH /api/config bodies (new ARBS keys included).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARBS_GAMEPAD_LIST,
  changedKeys,
  clampDays,
  clampGain,
  DEFAULTS,
  effectiveGamepad,
  GAMEPAD_TYPES,
  gamepadOptions,
  isHiddenGamepad,
  needsRestart,
  parseTriggerStatus,
  parseWebUiDefault,
  patchBody,
  readSettings,
  saveStateAfter,
  serialize,
  serverBool,
  triggerOptions,
} from '../logic/config.ts';

test('missing keys use the server defaults (h2b, precise clock on, arbs UI)', () => {
  const s = readSettings({});
  assert.deepEqual(s, DEFAULTS);
  assert.equal(s.arbs_trigger_status, 'h2b');
  assert.equal(s.arbs_enet_precise_time, true);
  assert.equal(s.arbs_webui_default, 'arbs');
  assert.equal(s.dualsense_haptics_gain, 1.0);
});

test('trigger status parsed like src/arbs_trigger_status.h', () => {
  assert.equal(parseTriggerStatus(''), 'h2b');
  assert.equal(parseTriggerStatus('H2B'), 'h2b');
  assert.equal(parseTriggerStatus('enabled'), 'enabled');
  assert.equal(parseTriggerStatus('true'), 'enabled');
  assert.equal(parseTriggerStatus('1'), 'enabled');
  assert.equal(parseTriggerStatus('disabled'), 'disabled');
  assert.equal(parseTriggerStatus('nonsense'), 'disabled');
});

test('server boolean truth table (config.cpp to_bool)', () => {
  for (const v of ['true', 'yes', 'enable', 'enabled', 'on', '1', 'ENABLED']) assert.equal(serverBool(v, false), true, v);
  for (const v of ['false', 'no', 'disabled', 'off', '0']) assert.equal(serverBool(v, true), false, v);
  assert.equal(serverBool(undefined, true), true);
  assert.equal(serverBool('', false), false);
});

test('default UI value is one of arbs/classic/v2', () => {
  assert.equal(parseWebUiDefault('classic'), 'classic');
  assert.equal(parseWebUiDefault('V2'), 'v2');
  assert.equal(parseWebUiDefault(' arbs '), 'arbs');
  assert.equal(parseWebUiDefault('legacy'), 'arbs');
  assert.equal(parseWebUiDefault(undefined), 'arbs');
});

test('PATCH body has only changed keys, values limited to the choices', () => {
  const original = readSettings({ gamepad: 'usbip_ds5' });
  assert.deepEqual(patchBody(original, original), {});
  const draft = { ...original, arbs_trigger_status: 'disabled' as const, arbs_enet_precise_time: false };
  assert.deepEqual(changedKeys(original, draft), ['arbs_trigger_status', 'arbs_enet_precise_time']);
  assert.deepEqual(patchBody(original, draft), { arbs_trigger_status: 'disabled', arbs_enet_precise_time: 'disabled' });
  assert.deepEqual(patchBody(original, { ...original, arbs_webui_default: 'classic' }), { arbs_webui_default: 'classic' });
  assert.deepEqual(patchBody(original, { ...original, controller: false }, ['gamepad']), {});
  assert.equal(serialize('arbs_trigger_status', 'h2b'), 'h2b');
  assert.equal(serialize('arbs_trigger_status', 'evil' as never), 'h2b');
  assert.equal(serialize('arbs_enet_precise_time', true), 'enabled');
  assert.equal(serialize('gamepad', 'usbip_ds5'), 'usbip_ds5');
  assert.equal(serialize('gamepad', 'bogus'), 'auto');
  assert.equal(serialize('virtual_display_mode', 'shared'), 'shared');
  assert.equal(serialize('dd_resolution_option', 'manual'), 'manual');
  assert.equal(serialize('dualsense_haptics_gain', 9), '4.0');
});

test('haptics gain clamps to 0.0-4.0 with one decimal', () => {
  assert.equal(clampGain(-1), 0);
  assert.equal(clampGain(4.7), 4);
  assert.equal(clampGain('1.26'), 1.3);
  assert.equal(clampGain('x'), 1);
});

test('restart notice for trigger status and precise clock; save states', () => {
  assert.equal(needsRestart(['arbs_trigger_status']), true);
  assert.equal(needsRestart(['arbs_enet_precise_time']), true);
  assert.equal(needsRestart(['gamepad', 'arbs_webui_default']), false);
  assert.equal(saveStateAfter({ status: true, appliedNow: true }, ['gamepad']), 'saved');
  assert.equal(saveStateAfter({ status: true, deferred: true }, ['gamepad']), 'deferred');
  assert.equal(saveStateAfter({ status: true, restartRequired: true }, ['gamepad']), 'restart');
  assert.equal(saveStateAfter({ status: true, appliedNow: true }, ['arbs_trigger_status']), 'restart');
  assert.equal(saveStateAfter({ status: false }, ['gamepad']), 'error');
});

test('H021 gamepad list: usbip_ds5 first, auto, the rest hidden (not removed from the server list)', () => {
  assert.deepEqual([...ARBS_GAMEPAD_LIST], ['usbip_ds5', 'auto']);
  assert.equal(GAMEPAD_TYPES.length, 11);
  assert.deepEqual(gamepadOptions('usbip_ds5'), [
    { value: 'usbip_ds5', hidden: false },
    { value: 'auto', hidden: false },
  ]);
  assert.deepEqual(gamepadOptions('auto').map((o) => o.value), ['usbip_ds5', 'auto']);
  for (const hidden of ['x360', 'ds4', 'vhf', 'vhf_xbox', 'vhf_xbox_one', 'vhf_ds4', 'vhf_ds5', 'vhf_switch', 'vhf_steam']) {
    assert.equal(isHiddenGamepad(hidden), true, hidden);
    const options = gamepadOptions(hidden);
    assert.deepEqual(options.map((o) => o.value), ['usbip_ds5', 'auto', hidden], hidden);
    assert.equal(options.at(-1)!.hidden, true, hidden);
  }
  assert.equal(isHiddenGamepad('usbip_ds5'), false);
  assert.equal(isHiddenGamepad('auto'), false);
  // The current value is shown as it is and is not changed: nothing goes into PATCH by itself.
  const original = readSettings({ gamepad: 'vhf_xbox' });
  assert.equal(original.gamepad, 'vhf_xbox');
  assert.deepEqual(patchBody(original, { ...original }), {});
  assert.equal(serialize('gamepad', 'vhf_xbox'), 'vhf_xbox');
  assert.equal(effectiveGamepad('vhf_xbox'), 'vhf_xbox');
  assert.equal(effectiveGamepad('nonsense'), 'auto');
});

test('H021 trigger status: h2b only, plus the current value when it is enabled or disabled', () => {
  assert.deepEqual(triggerOptions('h2b'), ['h2b']);
  assert.deepEqual(triggerOptions('disabled'), ['h2b', 'disabled']);
  assert.deepEqual(triggerOptions('enabled'), ['h2b', 'enabled']);
  const original = readSettings({ arbs_trigger_status: 'enabled' });
  assert.deepEqual(patchBody(original, { ...original }), {});
  assert.deepEqual(patchBody(original, { ...original, arbs_trigger_status: 'h2b' }), { arbs_trigger_status: 'h2b' });
});

test('H021 history settings (H-SET-173/174): defaults, reading, PATCH values', () => {
  const s = readSettings({});
  assert.equal(s.session_history_enabled, true);
  assert.equal(s.session_history_ttl_days, 0);
  assert.equal(readSettings({ session_history_enabled: 'disabled' }).session_history_enabled, false);
  assert.equal(readSettings({ session_history_ttl_days: '30' }).session_history_ttl_days, 30);
  assert.equal(clampDays('-3'), 0);
  assert.equal(clampDays('7.8'), 7);
  assert.equal(clampDays('x'), 0);
  assert.equal(serialize('session_history_enabled', false), 'disabled');
  assert.equal(serialize('session_history_ttl_days', 14), '14');
  assert.deepEqual(patchBody(s, { ...s, session_history_ttl_days: 30 }), { session_history_ttl_days: '30' });
  assert.equal(needsRestart(['session_history_enabled', 'session_history_ttl_days']), false);
});
