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
    for (const m of text.matchAll(/'((?:reason|save|guard|status|controller|account|display|stats)\.[a-z_0-9]+)'/g)) used.add(m[1]!);
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
    'apps.badge_': ['playnite', 'steam', 'lutris', 'default', 'custom', 'managed'],
    'apps.about_': ['desktop_what', 'desktop_when', 'steam_bp_what', 'steam_bp_when', 'input_what', 'input_when', 'monitor_what', 'monitor_when'],
    'gamepad_help.': ['usbip_ds5', 'auto'],
    'stats.grade_': ['good', 'warn', 'bad'],
    'stats.verdict_': ['healthy', 'degraded', 'failed', 'unknown'],
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
    // NET2 (0.3.0) remote access page
    'remote.step_': ['0', '1', '2', '3a', '3b', '3c', '3d', '4', '5'],
    'remote.grade_': ['good', 'warn', 'bad', 'info'],
    'remote.c_access_': ['this_pc', 'private', 'cgnat', 'public', 'ipv6', 'name'],
    'remote.c_': ['listeners_ok', 'listeners_failed', 'listeners_unknown', 'upnp_off', 'upnp_not_run', 'upnp_ok', 'upnp_private', 'upnp_failed', 'risk_ok', 'risk_wan', 'risk_upnp_wan', 'overlap', 'overlap_none', 'low_port'],
    'remote.a_': ['yes', 'no', 'unknown'],
    'remote.n_': ['already_tailscale', 'wan_not_public', 'unknown_means_tailscale'],
    'remote.role_': ['https', 'http', 'rtsp', 'video', 'control', 'audio'],
    'remote.igd_': ['none', 'connected', 'private_ip', 'disconnected', 'unknown_device', 'not_run'],
    'remote.e_': ['not_number', 'out_of_range'],
    'remote.w_': ['overlaps_sunshine', 'dynamic_range', 'same_as_now'],
    'remote.k_': ['upnp', 'origin_web_ui_allowed', 'port', 'lan_encryption_mode', 'wan_encryption_mode', 'enable_pairing'],
    'remote.g_': ['asus', 'tplink', 'stackon'],
    // H031 (0.3.1): outside step, finish summary, plain-language values
    'remote.s4_manual_e_': ['format', 'private'],
    'remote.sum_': ['method', 'rules', 'result', 'pairing'],
    'remote.sum_via_': ['tailscale', 'forward', 'upnp', 'none'],
    'remote.sum_result_': ['ok', 'fail', 'none'],
    'remote.v_': ['enabled', 'disabled', 'none', 'wan_off', 'wan_auto', 'wan_always', 'origin_pc', 'origin_lan', 'origin_wan'],
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

test('H021 fixed texts: hidden gamepad note, plan A reason, "not ARBS" note', () => {
  assert.equal(K['controller.gamepad_warning'], '아직 ARBS에서 확인되지 않은 종류입니다. ARBS에는 DualSense(usbip_ds5)를 권장합니다.');
  assert.match(E['controller.gamepad_warning']!, /not been confirmed with ARBS yet/);
  assert.doesNotMatch(K['controller.gamepad_warning']!, /일반 진동만/);
  assert.equal(K['reason.need_dualsense'], 'DualSense로 연결될 때만 적용됩니다(usbip_ds5 권장).');
  assert.equal(K['apps.badge_default'], '기본 앱');
  assert.match(K['apps.not_arbs']!, /ARBS 진동과 무관/);
  assert.match(K['gamepad.usbip_ds5']!, /ARBS 권장\(모든 기능\)/);
  assert.equal(K['nav.stats'], '통계');
});

test('NET2 fixed texts: other VPNs, link-only consent, port family benefit, no internal IDs', () => {
  assert.match(K['remote.s2_other']!, /\(예: Tailscale, ZeroTier\)/);
  assert.equal(K['remote.s4_check_consent'], '이 링크는 브라우저가 직접 엽니다. ARBS-H는 대신 요청하지 않습니다. 그 서비스는 접속한 공인 주소를 볼 수 있습니다.');
  assert.match(K['remote.s3d_benefit']!, /Vibepollo·Apollo 등\)과 같은 PC에 함께 설치할 때도 포트가 겹치지 않습니다/);
  assert.match(K['remote.s3d_e1']!, /주소 뒤에 :포트를 붙여 다시 추가해야 할 수 있습니다/);
  assert.match(K['remote.s3d_e2']!, /공유기 포트 포워딩 규칙도 새 포트로/);
  assert.match(K['remote.c_access_cgnat']!, /통신사 대역일 수도 있음/);
  assert.match(K['remote.f_moonlight']!, /47984·47989/);
  assert.match(K['remote.s3c_policy']!, /절대 열지 않습니다/);
  assert.equal(K['nav.remote'], '외부 접속');
  for (const [k, v] of Object.entries({ ...K, ...E })) {
    if (k.startsWith('remote.')) assert.doesNotMatch(v, /\bNET[0-9]\b|EA-|\bH0[0-9]{2}\b|\bD[0-9]{1,2}\b|\bP[0-9]\b/, k);
  }
});

test('H031: no setting key names (English config words) in the remote access texts', () => {
  for (const [k, v] of Object.entries({ ...K, ...E })) {
    if (!k.startsWith('remote.')) continue;
    assert.doesNotMatch(v, /[a-z0-9]+_[a-z0-9_]+/i, k);
    assert.doesNotMatch(v, /\((lan|wan|pc)\)/, k);
    assert.doesNotMatch(v, /origin_web_ui_allowed|lan_encryption_mode|wan_encryption_mode|enable_pairing/, k);
  }
  for (const gone of ['remote.s5_wan_enc', 'remote.s5_none', 'remote.s3b_addr_default', 'remote.s3b_addr_port', 'remote.s3b_pairing']) {
    assert.ok(!(gone in K) && !(gone in E), gone);
  }
});

test('H031: step names, outside step and finish texts', () => {
  assert.equal(K['remote.step_4'], '밖에서 접속');
  assert.equal(K['remote.step_5'], '마무리');
  assert.equal(K['remote.s5_title'], '마무리');
  assert.equal(K['remote.s5_advanced'], '바꾼 설정 되돌리기(고급)');
  assert.equal(K['remote.v_wan_auto'], '가능하면 켬(권장)');
  assert.match(K['remote.s4_wan_changes']!, /통신사가 바꿀 수 있어요/);
  assert.match(K['remote.s4_ddns']!, /DDNS/);
  assert.match(K['remote.s4_manual_help']!, /인터넷\(WAN\) 주소/);
  assert.match(K['remote.s4_manual_not_saved']!, /저장하지 않습니다/);
  assert.match(K['remote.s4_wan_note']!, /읽기만/);
  assert.match(K['remote.s4_2']!, /ARBS-W·ARBS-A/);
  assert.doesNotMatch(K['remote.s4_ok_text']!, /새 페어링/);
  // examples are documentation addresses only
  for (const [k, v] of Object.entries({ ...K, ...E })) {
    for (const m of v.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) assert.ok(m[0].startsWith('203.0.113.'), `${k}: ${m[0]}`);
  }
});
