// ARBS-H 0.3.0 (NET2): "외부 접속" page logic — ports, blocks, hiding, wizard branches, PATCH keys, prev_port.
// Addresses here are documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32); range tests use
// made-up values inside the range (x.217.43 style), never a common router value and never a real network value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';

import {
  allPorts,
  ARBS_PORT,
  checkPort,
  checks,
  DEFAULT_PORT,
  diagnosticsFromConfig,
  effectivePort,
  EXTERNAL_CHECK_URL,
  hideText,
  hostKind,
  inDynamicRange,
  isWizardKey,
  MASK,
  moonlightAddress,
  neverOpen,
  newWebUiUrl,
  originOf,
  overlapsSunshineDefault,
  parsePrevPort,
  parseStep,
  readChanges,
  readDiagnostics,
  recommend,
  recordChange,
  restoreBlockReason,
  ROUTER_GUIDE_LINKS,
  shown,
  STACKON_GUIDE_URL,
  streamPorts,
  TAILSCALE_URL,
  upnpBlockReason,
  WIZARD_KEYS,
  wizardPatch,
  ZEROTIER_URL,
} from '../logic/remote.ts';

const ports = (list: { port: number }[]) => list.map((p) => p.port);

test('port table follows the base: TCP base-5, base, base+21 / UDP base+9..11 (no web UI, no UDP +13 / +21)', () => {
  assert.deepEqual(ports(streamPorts(47989).tcp), [47984, 47989, 48010]);
  assert.deepEqual(ports(streamPorts(47989).udp), [47998, 47999, 48000]);
  assert.deepEqual(ports(streamPorts(45989).tcp), [45984, 45989, 46010]);
  assert.deepEqual(ports(streamPorts(45989).udp), [45998, 45999, 46000]);
  assert.deepEqual(ports(streamPorts(1029).tcp), [1024, 1029, 1050]);
  assert.deepEqual(ports(streamPorts(65514).tcp), [65509, 65514, 65535]);
  for (const base of [1029, 45989, 47989, 65514]) {
    const all = [...ports(streamPorts(base).tcp), ...ports(streamPorts(base).udp)];
    assert.ok(!all.includes(base + 1), 'web UI port is never in the table');
    assert.ok(!all.includes(base + 13) && !ports(streamPorts(base).udp).includes(base + 21), 'UDP +13 / +21 not listed');
    assert.deepEqual(neverOpen(base), [
      { port: base + 1, why: 'web_ui' },
      { port: 3240, why: 'usbip' },
    ]);
  }
  assert.deepEqual(allPorts(45989).sort(), [45984, 45989, 45990, 45998, 45999, 46000, 46010]);
  assert.equal(DEFAULT_PORT, 47989);
  assert.equal(ARBS_PORT, 45989);
});

test('Sunshine family overlap (47963 / 48015 edges) and dynamic range (49130 / 49131)', () => {
  assert.equal(overlapsSunshineDefault(47962), false);
  assert.equal(overlapsSunshineDefault(47963), true);
  assert.equal(overlapsSunshineDefault(47989), true);
  assert.equal(overlapsSunshineDefault(48015), true);
  assert.equal(overlapsSunshineDefault(48016), false);
  assert.equal(overlapsSunshineDefault(45989), false);
  assert.equal(inDynamicRange(49130), false);
  assert.equal(inDynamicRange(49131), true);
});

test('port change input: outside 1029..65514 or not a number is blocked, warnings otherwise', () => {
  assert.deepEqual(checkPort('abc', 47989), { port: null, error: 'not_number', warnings: [] });
  assert.deepEqual(checkPort('', 47989).error, 'not_number');
  assert.deepEqual(checkPort('45989.5', 47989).error, 'not_number');
  assert.equal(checkPort('1028', 47989).error, 'out_of_range');
  assert.equal(checkPort('65515', 47989).error, 'out_of_range');
  assert.deepEqual(checkPort('1029', 47989), { port: 1029, error: null, warnings: [] });
  assert.deepEqual(checkPort('65514', 47989), { port: 65514, error: null, warnings: ['dynamic_range'] });
  assert.deepEqual(checkPort('45989', 47989), { port: 45989, error: null, warnings: [] });
  assert.deepEqual(checkPort('47989', 47989).warnings, ['overlaps_sunshine', 'same_as_now']);
  assert.deepEqual(checkPort('49131', 47989).warnings, ['dynamic_range']);
  assert.deepEqual(checkPort('49130', 47989).warnings, []);
});

test('effective port: like the server (missing / bad / out of 1019..65514 = 47989)', () => {
  assert.equal(effectivePort(undefined), 47989);
  assert.equal(effectivePort(''), 47989);
  assert.equal(effectivePort('45989'), 45989);
  assert.equal(effectivePort(' 46000 '), 46000);
  assert.equal(effectivePort('"46000"'), 46000);
  assert.equal(effectivePort('1019'), 1019);
  assert.equal(effectivePort('1018'), 47989);
  assert.equal(effectivePort('65515'), 47989);
  assert.equal(effectivePort('x'), 47989);
});

test('UPnP + origin=wan is blocked on the screen (S3); the wizard never offers wan', () => {
  assert.equal(upnpBlockReason(true), 'remote.upnp_blocked_wan');
  assert.equal(upnpBlockReason(false), null);
  assert.throws(() => wizardPatch('origin_web_ui_allowed', 'wan'));
  assert.deepEqual(wizardPatch('origin_web_ui_allowed', 'lan'), { origin_web_ui_allowed: 'lan' });
  assert.equal(originOf({}), 'lan');
  assert.equal(originOf({ origin_web_ui_allowed: 'wan' }), 'wan');
  assert.equal(originOf({ origin_web_ui_allowed: 'nope' }), 'lan');
  const d = readDiagnostics({ port: 47989, upnp: { enabled: true, igd: 'connected' }, risk: { origin_wan: true } }, {});
  const risk = checks(d, 'private').find((c) => c.id === 'risk');
  assert.deepEqual(risk, { id: 'risk', grade: 'bad', text: 'remote.c_risk_upnp_wan' });
});

test('PATCH only the 6 wizard keys, only offered values; restore writes the old value back', () => {
  assert.deepEqual([...WIZARD_KEYS], ['upnp', 'origin_web_ui_allowed', 'port', 'lan_encryption_mode', 'wan_encryption_mode', 'enable_pairing']);
  for (const key of ['gamepad', 'pkey', 'cert', 'address_family', 'credentials_file', 'origin_pin_allowed', '']) {
    assert.equal(isWizardKey(key), false, key);
    assert.throws(() => wizardPatch(key, 'x'), key);
    assert.throws(() => wizardPatch(key, 'x', true), key);
  }
  assert.deepEqual(wizardPatch('upnp', 'enabled'), { upnp: 'enabled' });
  assert.throws(() => wizardPatch('upnp', 'maybe'));
  assert.deepEqual(wizardPatch('port', '45989'), { port: '45989' });
  assert.throws(() => wizardPatch('port', '1028'));
  assert.throws(() => wizardPatch('port', '99999'));
  assert.deepEqual(wizardPatch('lan_encryption_mode', '1'), { lan_encryption_mode: '1' });
  assert.throws(() => wizardPatch('lan_encryption_mode', '2'));
  assert.throws(() => wizardPatch('wan_encryption_mode', '2'), 'D8: the wizard does not change wan_encryption_mode');
  assert.deepEqual(wizardPatch('enable_pairing', 'disabled'), { enable_pairing: 'disabled' });
  assert.deepEqual(wizardPatch('port', '', true, {}), { port: '' }, 'restore "no line" removes the key');
  assert.deepEqual(wizardPatch('wan_encryption_mode', '1', true, {}), { wan_encryption_mode: '1' });
  assert.throws(() => wizardPatch('port', '', true), /needs the current settings/);
});

test('S3 on "이전 값으로": never back into UPnP on + origin = wan (both directions)', () => {
  // Reproduction from the check: origin starts at wan -> 3c "lan" -> "UPnP on" -> step 5 "Previous value" for origin.
  let config: Record<string, unknown> = { origin_web_ui_allowed: 'wan' };
  let list = recordChange([], 'origin_web_ui_allowed', 'wan', 'lan');
  config = { ...config, ...wizardPatch('origin_web_ui_allowed', 'lan') };
  assert.equal(upnpBlockReason(originOf(config) === 'wan'), null, '3c: UPnP on is allowed once origin is lan');
  list = recordChange(list, 'upnp', '', 'enabled');
  config = { ...config, ...wizardPatch('upnp', 'enabled') };
  const origin = list.find((c) => c.key === 'origin_web_ui_allowed')!;
  assert.equal(origin.before, 'wan');
  // (a) origin back to wan while UPnP is on: blocked, button reason + wizardPatch refuses.
  assert.equal(restoreBlockReason(origin.key, origin.before, config), 'remote.revert_blocked_origin');
  assert.throws(() => wizardPatch(origin.key, origin.before, true, config), /restore blocked/);
  // UPnP back to its value before ('' = no line = off) is fine; after that origin can go back to wan.
  const upnp = list.find((c) => c.key === 'upnp')!;
  assert.equal(restoreBlockReason(upnp.key, upnp.before, config), null);
  assert.deepEqual(wizardPatch(upnp.key, upnp.before, true, config), { upnp: '' });
  config = { origin_web_ui_allowed: 'lan' };
  assert.equal(restoreBlockReason(origin.key, origin.before, config), null);
  assert.deepEqual(wizardPatch(origin.key, origin.before, true, config), { origin_web_ui_allowed: 'wan' });

  // (b) UPnP back to enabled while origin = wan (UPnP was on before, the user turned it off, origin was set to wan elsewhere).
  const wanNoUpnp = { origin_web_ui_allowed: 'wan', upnp: 'disabled' };
  assert.equal(restoreBlockReason('upnp', 'enabled', wanNoUpnp), 'remote.revert_blocked_upnp');
  assert.throws(() => wizardPatch('upnp', 'enabled', true, wanNoUpnp), /restore blocked/);
  for (const on of ['enabled', 'true', 'on', '1', 'yes']) {
    assert.equal(restoreBlockReason('upnp', on, wanNoUpnp), 'remote.revert_blocked_upnp', on);
  }
  // The running server still at wan (file already lan, no restart yet) also blocks UPnP back on.
  assert.equal(restoreBlockReason('upnp', 'enabled', { origin_web_ui_allowed: 'lan' }, true), 'remote.revert_blocked_upnp');
  assert.equal(restoreBlockReason('upnp', 'enabled', { origin_web_ui_allowed: 'lan' }, false), null);
  assert.equal(restoreBlockReason('upnp', 'disabled', wanNoUpnp, true), null, 'turning UPnP off is never blocked');
  // origin back to wan is judged by the file value (the key itself), not by the running origin.
  assert.equal(restoreBlockReason('origin_web_ui_allowed', 'lan', { upnp: 'enabled' }, true), null);
  assert.equal(restoreBlockReason('origin_web_ui_allowed', 'WAN', { upnp: 'enabled' }), 'remote.revert_blocked_origin');
  assert.equal(restoreBlockReason('origin_web_ui_allowed', '', { upnp: 'enabled' }), null, "'' = server default lan");
  // Other keys are never blocked, even when the settings already have the combination.
  const both = { origin_web_ui_allowed: 'wan', upnp: 'enabled' };
  for (const key of ['port', 'lan_encryption_mode', 'wan_encryption_mode', 'enable_pairing']) {
    assert.equal(restoreBlockReason(key, '', both, true), null, key);
  }
  assert.deepEqual(wizardPatch('port', '', true, both, true), { port: '' });
});

test('change list keeps the first "before" and drops a key that is back to it', () => {
  let list = recordChange([], 'port', '', '45989');
  list = recordChange(list, 'port', '45989', '46000');
  assert.deepEqual(list, [{ key: 'port', before: '', after: '46000' }]);
  list = recordChange(list, 'enable_pairing', '', 'disabled');
  assert.equal(list.length, 2);
  list = recordChange(list, 'port', '46000', '');
  assert.deepEqual(list, [{ key: 'enable_pairing', before: '', after: 'disabled' }]);
  assert.deepEqual(readChanges(JSON.stringify(list)), list);
  assert.deepEqual(readChanges('[{"key":"gamepad","before":"","after":"x"}]'), []);
  assert.deepEqual(readChanges('nope'), []);
  assert.deepEqual(readChanges(null), []);
});

test('addresses are hidden by default; JSON, String() and console show only the mask', () => {
  const secret = hideText('203.0.113.45');
  assert.equal(shown(secret, false), MASK);
  assert.equal(shown(secret, true), '203.0.113.45');
  assert.equal(String(secret), MASK);
  assert.equal(`${secret}`, MASK);
  assert.equal(JSON.stringify({ secret }), JSON.stringify({ secret: MASK }));
  assert.doesNotMatch(inspect(secret), /203\.0\.113/);
  assert.doesNotMatch(inspect({ list: [secret] }, { depth: 5 }), /203\.0\.113/);
  assert.ok(Object.isFrozen(secret));
  const d = readDiagnostics(
    { port: 45989, interfaces: [{ kind: 'cgnat_v4', address: '203.0.113.45', tailscale_like: true }, { kind: 'loopback', address: '127.0.0.1' }] },
    {},
  );
  assert.equal(d.interfaces.length, 1, 'unknown kinds dropped');
  assert.doesNotMatch(JSON.stringify(d), /203\.0\.113|127\.0/);
  assert.doesNotMatch(inspect(d, { depth: 10 }), /203\.0\.113/);
  assert.equal(d.interfaces[0]!.address.reveal(), '203.0.113.45');
});

test('text for Moonlight: ":port" when not 47989, [IPv6]:port', () => {
  assert.equal(moonlightAddress('198.51.100.23', 47989), '198.51.100.23');
  assert.equal(moonlightAddress('198.51.100.23', 45989), '198.51.100.23:45989');
  assert.equal(moonlightAddress('203.0.113.45', 46000), '203.0.113.45:46000');
  assert.equal(moonlightAddress('2001:db8::1', 45989), '[2001:db8::1]:45989');
  assert.equal(moonlightAddress('2001:db8::1', 47989), '2001:db8::1');
});

test('kind of the address this page was opened with', () => {
  assert.equal(hostKind('localhost'), 'this_pc');
  assert.equal(hostKind('127.0.0.1'), 'this_pc');
  assert.equal(hostKind('[::1]'), 'this_pc');
  assert.equal(hostKind('192.168.217.43'), 'private');
  assert.equal(hostKind('10.217.43.9'), 'private');
  assert.equal(hostKind('172.20.217.43'), 'private');
  assert.equal(hostKind('172.32.217.43'), 'public');
  assert.equal(hostKind('100.64.217.43'), 'cgnat');
  assert.equal(hostKind('100.127.217.43'), 'cgnat');
  assert.equal(hostKind('100.128.217.43'), 'public');
  assert.equal(hostKind('203.0.113.7'), 'public');
  assert.equal(hostKind('[2001:db8::1]'), 'ipv6');
  assert.equal(hostKind('my-pc.example'), 'name');
});

test('wizard branches: 2 questions x the address kind', () => {
  const kinds = ['this_pc', 'private', 'cgnat', 'public', 'ipv6', 'name'] as const;
  const answers = ['yes', 'no', 'unknown'] as const;
  for (const host of kinds) {
    for (const router of answers) {
      for (const wan of answers) {
        const r = recommend(router, wan, host, 'unknown');
        assert.equal(r.method, router === 'yes' && wan === 'yes' ? 'forward' : 'tailscale', `${host} ${router} ${wan}`);
        assert.equal(r.notes.includes('already_tailscale'), host === 'cgnat');
        assert.equal(r.notes.includes('unknown_means_tailscale'), router === 'unknown' || wan === 'unknown');
      }
    }
  }
  // A router WAN known to be private / CGNAT (UPnP) means forwarding cannot work: Tailscale.
  assert.deepEqual(recommend('yes', 'yes', 'private', 'cgnat'), { method: 'tailscale', notes: ['wan_not_public'] });
  assert.deepEqual(recommend('yes', 'yes', 'private', 'private').method, 'tailscale');
  assert.deepEqual(recommend('yes', 'yes', 'private', 'public'), { method: 'forward', notes: [] });
});

test('step 1 checks from the server reply and from /api/config only', () => {
  const good = readDiagnostics(
    {
      port: 45989,
      port_note: '',
      listeners: { nvhttp_http: 'ok', nvhttp_https: 'ok', confighttp: 'ok', rtsp: 'ok', stream: 'not_started' },
      upnp: { enabled: false, igd: 'not_run' },
      interfaces_supported: true,
      risk: { origin_wan: false },
    },
    {},
  );
  const byId = (list: ReturnType<typeof checks>) => Object.fromEntries(list.map((c) => [c.id, c.grade]));
  assert.deepEqual(byId(checks(good, 'private')), { listeners: 'good', access: 'info', upnp: 'info', risk: 'good', overlap: 'good' });
  const bad = readDiagnostics({ port: 1024, port_note: 'below_1029', listeners: { rtsp: 'failed' }, upnp: { enabled: true, igd: 'private_ip' } }, {});
  const b = byId(checks(bad, 'public'));
  assert.equal(b.listeners, 'bad');
  assert.equal(b.access, 'warn');
  assert.equal(b.upnp, 'warn');
  assert.equal(b.low_port, 'warn');
  const fallback = diagnosticsFromConfig({ port: '47989', upnp: 'enabled', origin_web_ui_allowed: 'wan' });
  assert.equal(fallback.source, 'config');
  assert.equal(fallback.port, 47989);
  assert.equal(fallback.upnp.enabled, true);
  assert.equal(fallback.originWan, true);
  const f = byId(checks(fallback, 'private'));
  assert.equal(f.listeners, 'info');
  assert.equal(f.overlap, 'warn');
  assert.equal(f.risk, 'bad');
  assert.ok(checks(fallback, 'cgnat').some((c) => c.text === 'remote.c_access_cgnat'));
});

test('prev_port and step from the query; new web UI link', () => {
  assert.equal(parsePrevPort('47989'), 47989);
  assert.equal(parsePrevPort(['45989']), 45989);
  assert.equal(parsePrevPort('1018'), null);
  assert.equal(parsePrevPort('47989x'), null);
  assert.equal(parsePrevPort('198.51.100.23'), null, 'never an address');
  assert.equal(parsePrevPort(undefined), null);
  assert.equal(parseStep('3d'), '3d');
  assert.equal(parseStep('9'), '0');
  assert.equal(newWebUiUrl('example.local', 45989, 47989), 'https://example.local:45990/arbs/remote?step=5&prev_port=47989');
});

test('links: official sites only, STACKON and outside check empty (hidden) until filled', () => {
  assert.equal(STACKON_GUIDE_URL, '');
  assert.equal(EXTERNAL_CHECK_URL, '');
  assert.match(TAILSCALE_URL, /^https:\/\/tailscale\.com\//);
  assert.match(ZEROTIER_URL, /^https:\/\/www\.zerotier\.com\//);
  for (const link of ROUTER_GUIDE_LINKS) assert.match(link.url, /^https:\/\/www\.(asus\.com|tp-link\.com)\//);
});
