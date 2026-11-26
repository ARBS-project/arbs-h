// ARBS-H UI1b: devices, apps and logs helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appBadge,
  appsFrom,
  defaultAppKind,
  editFrom,
  moveOrder,
  NOT_ARBS_APPS,
  restorableSystemApps,
  savePayload,
  visibleCount,
} from '../logic/apps.ts';
import {
  cleanPin,
  deviceStatus,
  normalizeDevice,
  normalizedPin,
  PERMISSION_ALL,
  PERMISSIONS,
  togglePermission,
  updatePayload,
} from '../logic/clients.ts';
import { fatalLines, filterLines, matchIndexes, parseLog, stepMatch, summary } from '../logic/logs.ts';

test('permission bits match src/crypto.h', () => {
  const all = PERMISSIONS.reduce((m, p) => m | p.bit, 0);
  // file upload/download (0x40000, 0x80000) are not shown but kept in the mask.
  assert.equal(all | 0x40000 | 0x80000, PERMISSION_ALL);
  assert.equal(togglePermission(0, 0x02000000, true), 0x02000000);
  assert.equal(togglePermission(PERMISSION_ALL, 0x100, false) & 0x100, 0);
  assert.equal(togglePermission(0, 0x40000000, true), 0);
});

test('device status words', () => {
  const d = (raw: Record<string, unknown>) => normalizeDevice({ uuid: 'u', perm: 0x03000000, ...raw }, 0);
  assert.equal(deviceStatus(d({ connected: true })), 'streaming');
  assert.equal(deviceStatus(d({ enabled: false })), 'blocked');
  assert.equal(deviceStatus(d({ perm: 0 })), 'blocked');
  assert.equal(deviceStatus(d({ last_seen: 1700000000 })), 'active');
  assert.equal(deviceStatus(d({})), 'never_seen');
});

test('device update keeps the fields this UI does not edit', () => {
  const device = normalizeDevice(
    {
      uuid: 'u1',
      name: 'Old',
      perm: 0x03000000,
      display_mode: '1920x1080x60',
      output_name_override: '',
      virtual_display_mode: 'shared',
      virtual_display_layout: 'exclusive',
      always_use_virtual_display: true,
      enable_legacy_ordering: false,
      allow_client_commands: false,
      prefer_10bit_sdr: true,
      do: [{ cmd: 'a', elevated: false }],
      undo: [{ cmd: 'b', elevated: true }],
    },
    0,
  );
  const body = updatePayload(device, { name: ' New ', perm: 0x07000000, allow_sleep: true });
  assert.deepEqual(body, {
    uuid: 'u1',
    name: 'New',
    perm: 0x07000000,
    allow_sleep: true,
    enable_legacy_ordering: false,
    allow_client_commands: false,
    always_use_virtual_display: true,
    display_mode: '1920x1080x60',
    output_name_override: '',
    virtual_display_mode: 'shared',
    virtual_display_layout: 'exclusive',
    prefer_10bit_sdr: true,
    do: [{ cmd: 'a', elevated: false }],
    undo: [{ cmd: 'b', elevated: true }],
  });
});

test('PIN digits only, up to 4, zero padded', () => {
  assert.equal(cleanPin('12a34 5'), '1234');
  assert.equal(normalizedPin('7'), '0007');
  assert.equal(normalizedPin('0123'), '0123');
});

test('app save body: edit merged into the latest record, transient fields removed', () => {
  const base = { uuid: 'a1', name: 'Old', cmd: 'old.exe', index: 3, 'image-version': 2, output: 'x', 'prep-cmd': [{ do: 'p' }] };
  const body = savePayload(base, { name: ' Game ', cmd: ' game.exe ', imagePath: 'c.png', elevated: true, dualsenseHaptics: true });
  assert.equal(body.uuid, 'a1');
  assert.equal(body.name, 'Game');
  assert.equal(body.cmd, 'game.exe');
  assert.equal(body['image-path'], 'c.png');
  assert.equal(body['dualsense-haptics'], true);
  assert.equal(body.elevated, true);
  assert.equal(body.output, 'x');
  assert.equal('index' in body, false);
  assert.equal('image-version' in body, false);
  assert.deepEqual(body['prep-cmd'], [{ do: 'p' }]);
  assert.deepEqual(body.detached, []);
  const created = savePayload(null, editFrom(null));
  assert.equal(created.index, -1);
  assert.equal('uuid' in created, false);
});

test('app list shape, order and paging', () => {
  assert.equal(appsFrom({ apps: [{ uuid: 'a' }, null, 3] }).length, 1);
  assert.equal(appsFrom([{ uuid: 'a' }, { uuid: 'b' }]).length, 2);
  assert.deepEqual(moveOrder(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveOrder(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.equal(visibleCount(30, 1), 12);
  assert.equal(visibleCount(30, 3), 30);
  assert.equal(editFrom({ cmd: ['a', 'b'], 'dualsense-haptics': 'true' }).cmd, 'a b');
  assert.equal(editFrom({ 'dualsense-haptics': 'true' }).dualsenseHaptics, true);
});

test('H021: the 4 install default apps get the "default" badge, the others keep theirs', () => {
  // Shapes as GET /api/apps returns them (src_assets/windows/assets/apps.json + server remote-session apps).
  const desktop = { uuid: 'd', name: 'Desktop', 'image-path': 'desktop.png' };
  const steamBp = { uuid: 's', name: 'Steam Big Picture', detached: ['steam://open/bigpicture'], 'prep-cmd': [{ undo: 'steam://close/bigpicture' }] };
  const input = { uuid: 'i', name: 'Remote Input', 'remote-session': 'input' };
  const monitor = { uuid: 'm', name: 'Remote Monitor', 'remote-session': 'monitor' };
  assert.equal(defaultAppKind(desktop), 'desktop');
  assert.equal(defaultAppKind(steamBp), 'steam_bp');
  assert.equal(defaultAppKind(input), 'input');
  assert.equal(defaultAppKind(monitor), 'monitor');
  for (const app of [desktop, steamBp, input, monitor]) assert.equal(appBadge(app), 'default', String(app.name));
  // Renamed Desktop is no longer the server's system app; look-alikes without the marks are custom.
  assert.equal(appBadge({ name: 'My Desktop' }), 'custom');
  assert.equal(appBadge({ name: 'Steam Big Picture', detached: [] }), 'custom');
  assert.equal(appBadge({ name: 'Remote Input' }), 'custom');
  // Library apps keep their source badge first.
  assert.equal(appBadge({ name: 'Desktop', 'playnite-id': 'p' }), 'playnite');
  assert.equal(appBadge({ name: 'Elden Ring', 'steam-id': '1245620' }), 'steam');
  assert.equal(appBadge({ name: 'Game', 'lutris-id': 'l' }), 'lutris');
  assert.equal(appBadge({ name: 'Game' }), 'custom');
  assert.deepEqual([...NOT_ARBS_APPS], ['input', 'monitor']);
  assert.equal(defaultAppKind(null), null);
});

test('H021: restore buttons only for the default apps the server lists as missing', () => {
  assert.deepEqual([...restorableSystemApps({ apps: [], 'restorable-system-apps': [{ id: 'monitor', name: 'Remote Monitor' }] })], ['monitor']);
  assert.deepEqual([...restorableSystemApps({ apps: [], 'restorable-system-apps': [] })], []);
  assert.deepEqual([...restorableSystemApps({ apps: [], 'restorable-system-apps': [{ id: 'steam_bp' }, { id: 'input' }, null] })], ['input']);
  // Older server without the list: all three stay available (previous behaviour).
  assert.deepEqual([...restorableSystemApps({ apps: [] })].sort(), ['desktop', 'input', 'monitor']);
  assert.deepEqual([...restorableSystemApps([])].sort(), ['desktop', 'input', 'monitor']);
});

test('log levels, filter, search, summary, fatal lines', () => {
  const text = [
    '[2026-11-25 10:00:00.000]: Info: started',
    '[2026-11-25 10:00:01.000]: Warning: slow',
    '[2026-11-25 10:00:02.000]: Error: broke',
    '[2026-11-25 10:00:03.000]: Fatal: no encoder',
    '[2026-11-25 10:00:04.000]: Debug: detail',
    '',
  ].join('\r\n');
  const lines = parseLog(text);
  assert.equal(lines.length, 5);
  assert.deepEqual(summary(lines), { errors: 2, warnings: 1, total: 5 });
  assert.equal(filterLines(lines, 'warning').length, 3);
  assert.equal(filterLines(lines, 'error').length, 2);
  assert.equal(filterLines(lines, 'debug').length, 1);
  assert.deepEqual(matchIndexes(lines, 'BROKE'), [2]);
  assert.deepEqual(matchIndexes(lines, '  '), []);
  assert.equal(stepMatch(-1, 3, 1), 0);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 0, 1), -1);
  assert.deepEqual(fatalLines(text), ['[2026-11-25 10:00:03.000]: Fatal: no encoder']);
});
