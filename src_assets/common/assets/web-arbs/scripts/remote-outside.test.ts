// ARBS-H 0.3.1 (H031 F2-F4): outside address (router answer / typed in) -> value for Moonlight, chosen method and result
// for the "마무리" summary, plain-language values, and the step layout (3b router only, 4 outside, 5 finish).
// Addresses are documentation ranges (203.0.113.0/24, 198.51.100.0/24, 2001:db8::/32) or made-up values inside a range
// (x.217.43 style), never a common router value and never a real network value.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import {
  easyValue,
  finishSummary,
  MASK,
  outsideValue,
  parseVia,
  PROGRESS_KEY,
  readProgress,
  readRouterWan,
  WIZARD_KEYS,
} from '../logic/remote.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const plain = (o: { value: { reveal(): string } | null }) => o.value?.reveal() ?? null;

test('typed outside address -> value for Moonlight (port added, nothing else changed)', () => {
  assert.equal(plain(outsideValue('203.0.113.7', 45989)), '203.0.113.7:45989');
  assert.equal(plain(outsideValue('  203.0.113.7  ', 45989)), '203.0.113.7:45989');
  assert.equal(plain(outsideValue('203.0.113.7', 47989)), '203.0.113.7', 'default port: no :port');
  assert.equal(plain(outsideValue('http://203.0.113.7/', 45989)), '203.0.113.7:45989');
  assert.equal(plain(outsideValue('https://203.0.113.7/status?x=1', 45989)), '203.0.113.7:45989');
  const same = outsideValue('203.0.113.7:45989', 45989);
  assert.equal(plain(same), '203.0.113.7:45989');
  assert.equal(same.portReplaced, false);
  const other = outsideValue('203.0.113.7:1234', 45989);
  assert.equal(plain(other), '203.0.113.7:45989', 'a typed port is replaced by this PC port');
  assert.equal(other.portReplaced, true);
  assert.equal(plain(outsideValue('198.51.100.23', 45989)), '198.51.100.23:45989');
});

test('DDNS name and global IPv6 work; IPv6 gets [ ]:port', () => {
  assert.equal(plain(outsideValue('myhome.example.com', 45989)), 'myhome.example.com:45989');
  assert.equal(plain(outsideValue('MyHome.Example.COM:47989', 45989)), 'myhome.example.com:45989');
  assert.equal(plain(outsideValue('2001:db8::7', 45989)), '[2001:db8::7]:45989');
  assert.equal(plain(outsideValue('[2001:db8::7]:1234', 45989)), '[2001:db8::7]:45989');
  assert.equal(plain(outsideValue('2001:db8::7', 47989)), '2001:db8::7');
});

test('private, 100.64, loopback, 0.x and link-local addresses are refused (they do not work from outside)', () => {
  for (const text of ['192.168.217.43', '10.217.0.43', '172.20.217.43', '100.64.217.43', '100.127.217.43', '127.0.0.1', '0.0.0.0', '169.254.217.43', 'fe80::7', 'fd7a:115c:a1e0::7', '::1']) {
    const r = outsideValue(text, 45989);
    assert.equal(r.error, 'private', text);
    assert.equal(r.value, null, text);
  }
  // 100.63.x and 100.128.x are outside the 100.64/10 range: public
  assert.equal(outsideValue('100.63.217.43', 45989).error, null);
  assert.equal(outsideValue('100.128.217.43', 45989).error, null);
});

test('empty and malformed input', () => {
  assert.equal(outsideValue('', 45989).error, 'empty');
  assert.equal(outsideValue('   ', 45989).error, 'empty');
  for (const text of ['203.0.113', '203.0.113.256', '203.0.113.7.1', 'abc', 'my home.example.com', '203.0.113.7:port', ':45989', 'example.local', 'printer.localhost', '224.0.0.7']) {
    const r = outsideValue(text, 45989);
    assert.ok(r.error === 'format' || r.error === 'private', `${text}: ${r.error}`);
    assert.equal(r.value, null, text);
  }
  assert.equal(outsideValue('224.0.0.7', 45989).error, 'private');
});

test('the made value hides itself in strings, JSON and console output', () => {
  const r = outsideValue('203.0.113.7', 45989);
  assert.equal(String(r.value), MASK);
  assert.equal(JSON.stringify(r), JSON.stringify({ value: MASK, host: MASK, error: null, portReplaced: false }));
  assert.equal(r.host?.reveal(), '203.0.113.7');
  assert.equal(outsideValue('[2001:db8::7]:1234', 45989).host?.reveal(), '2001:db8::7');
  assert.ok(!inspect(r).includes('203.0.113.7'));
});

test('router answer: only a public address is kept; private / 100.64 / errors give no address (P-10)', () => {
  const ok = readRouterWan({ status: true, router_wan: { state: 'ok', kind: 'public', address: '203.0.113.7' } });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.kind, 'public');
  assert.equal(ok.address?.reveal(), '203.0.113.7');
  assert.equal(JSON.stringify(ok), JSON.stringify({ state: 'ok', kind: 'public', address: MASK }));
  // a server that would send a private value: dropped
  const priv = readRouterWan({ router_wan: { state: 'ok', kind: 'private', address: '192.168.217.43' } });
  assert.deepEqual([priv.state, priv.kind, priv.address], ['ok', 'private', null]);
  const cg = readRouterWan({ router_wan: { state: 'ok', kind: 'cgnat' } });
  assert.deepEqual([cg.state, cg.kind, cg.address], ['ok', 'cgnat', null]);
  // "public" but the text is not public: no address, kind unknown
  const lie = readRouterWan({ router_wan: { state: 'ok', kind: 'public', address: '10.217.0.43' } });
  assert.deepEqual([lie.kind, lie.address], ['unknown', null]);
  for (const state of ['no_router', 'no_answer', 'busy']) {
    const r = readRouterWan({ router_wan: { state, kind: 'public', address: '203.0.113.7' } });
    assert.deepEqual([r.state, r.kind, r.address], [state, 'unknown', null], state);
  }
  for (const raw of [null, {}, { status: true }, 'x', { router_wan: { state: 'weird' } }]) {
    assert.equal(readRouterWan(raw).state, 'error', JSON.stringify(raw));
  }
});

test('chosen method from the query / session; result kept, no address', () => {
  assert.equal(parseVia('forward'), 'forward');
  assert.equal(parseVia(['upnp']), 'upnp');
  assert.equal(parseVia('203.0.113.7'), null);
  assert.equal(parseVia(undefined), null);
  assert.equal(PROGRESS_KEY, 'arbs.remote.progress');
  assert.deepEqual(readProgress(JSON.stringify({ via: 'tailscale', result: 'ok' })), { via: 'tailscale', result: 'ok' });
  assert.deepEqual(readProgress(JSON.stringify({ via: 'x', result: 'maybe', address: '203.0.113.7' })), { via: 'none', result: '' });
  assert.deepEqual(readProgress('not json'), { via: 'none', result: '' });
  assert.deepEqual(readProgress(null), { via: 'none', result: '' });
  assert.deepEqual(readProgress('null'), { via: 'none', result: '' });
});

test('"마무리" summary: method, rules (forward / UPnP only), result, new pairing', () => {
  const f = finishSummary({ via: 'forward', result: 'ok' }, 45989, false);
  assert.deepEqual(f.map((r) => r.id), ['method', 'rules', 'result', 'pairing']);
  assert.equal(f[0]!.text, 'remote.sum_via_forward');
  assert.deepEqual(f[1]!.params, { tcp: '45984, 45989, 46010', udp: '45998, 45999, 46000' });
  assert.equal(f[2]!.text, 'remote.sum_result_ok');
  assert.equal(f[3]!.text, 'remote.sum_pairing_off');
  assert.equal(f[3]!.advice, undefined);
  const t = finishSummary({ via: 'tailscale', result: '' }, 47989, true);
  assert.deepEqual(t.map((r) => r.id), ['method', 'result', 'pairing']);
  assert.equal(t[1]!.text, 'remote.sum_result_none');
  assert.equal(t[2]!.text, 'remote.sum_pairing_on');
  assert.equal(t[2]!.advice, 'remote.sum_pairing_advice');
  const u = finishSummary({ via: 'upnp', result: 'fail' }, 47989, true);
  assert.equal(u[1]!.text, 'remote.sum_rules_upnp');
  assert.equal(u[2]!.text, 'remote.sum_result_fail');
  assert.equal(finishSummary({ via: 'none', result: '' }, 47989, true)[0]!.text, 'remote.sum_via_none');
});

test('plain-language values: never the raw config word', () => {
  assert.deepEqual(easyValue('wan_encryption_mode', '1'), { text: 'remote.v_wan_auto' });
  assert.deepEqual(easyValue('wan_encryption_mode', '0'), { text: 'remote.v_wan_off' });
  assert.deepEqual(easyValue('wan_encryption_mode', '2'), { text: 'remote.v_wan_always' });
  assert.deepEqual(easyValue('lan_encryption_mode', '0'), { text: 'remote.v_disabled' });
  assert.deepEqual(easyValue('lan_encryption_mode', '1'), { text: 'remote.v_enabled' });
  assert.deepEqual(easyValue('origin_web_ui_allowed', 'lan'), { text: 'remote.v_origin_lan' });
  assert.deepEqual(easyValue('origin_web_ui_allowed', 'wan'), { text: 'remote.v_origin_wan' });
  assert.deepEqual(easyValue('origin_web_ui_allowed', 'pc'), { text: 'remote.v_origin_pc' });
  assert.deepEqual(easyValue('upnp', 'enabled'), { text: 'remote.v_enabled' });
  assert.deepEqual(easyValue('enable_pairing', 'disabled'), { text: 'remote.v_disabled' });
  assert.deepEqual(easyValue('port', '45989'), { raw: '45989' });
  for (const key of WIZARD_KEYS) assert.deepEqual(easyValue(key, ''), { text: 'remote.v_none' }, key);
});

/** Template of one step section: from `data-remote-step="<id>"` up to the next step section. */
function section(view: string, id: string): string {
  const start = view.indexOf(`data-remote-step="${id}"`);
  assert.ok(start > 0, id);
  const next = view.indexOf('data-remote-step="', start + 20);
  return view.slice(start, next > 0 ? next : undefined);
}

test('3b = router settings only; outside value, PIN and new pairing are on 4; 5 = summary + closed advanced undo', () => {
  const view = readFileSync(join(root, 'views/RemoteAccessView.vue'), 'utf8');
  const s3b = section(view, '3b');
  for (const gone of ['pairing', 's3b_addr', 'data-outside-value', 'data-manual']) assert.ok(!s3b.includes(gone), `3b has ${gone}`);
  for (const kept of ['data-local', 'data-port-table', 'remote.s3b_3', 'data-guide', 'data-next-4', 's3b_lead']) assert.ok(s3b.includes(kept), `3b lacks ${kept}`);
  // the router makers' links sit under item 3 (two routers)
  assert.ok(s3b.indexOf('remote.s3b_3') < s3b.indexOf('data-guide'));
  const s4 = section(view, '4');
  const order = ['remote.s4_1', 'data-outside-value', 'data-manual', 'remote.s4_wan_changes', 'remote.s4_ddns', 'data-pin-link', 'data-action="pairing-off"', 'data-result="ok"'];
  let at = -1;
  for (const mark of order) {
    const i = s4.indexOf(mark);
    assert.ok(i > at, `4: ${mark} in order`);
    at = i;
  }
  assert.ok(s4.includes('to="/devices/pair"'));
  const s5 = section(view, '5');
  assert.ok(s5.includes('data-summary'));
  assert.ok(/<details v-if="changes\.length"[^>]*data-advanced-revert/.test(s5), 'advanced undo only when something changed');
  assert.ok(s5.indexOf('data-summary') < s5.indexOf('data-advanced-revert'));
  assert.ok(s5.indexOf('<details') < s5.indexOf('data-changes'), 'the change table is inside the closed box');
  assert.ok(!s5.includes('wan_enc') && !s5.includes('s5_none'));
});

test('no address goes into the address bar or storage: progress has method and result only', () => {
  const view = readFileSync(join(root, 'views/RemoteAccessView.vue'), 'utf8');
  assert.match(view, /setItem\(PROGRESS_KEY, JSON\.stringify\(p\)\)/);
  assert.doesNotMatch(view, /setItem\([^)]*(manual|wan\.value)/);
  assert.doesNotMatch(view, /query\.(address|wan|manual)/);
  assert.doesNotMatch(view, /console\./);
});
