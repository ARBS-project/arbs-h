// ARBS-H 0.3.0 (NET2): "외부 접속" (remote access) page logic, docs/analysis/NET2.md §3.
// Pure functions and constants so scripts/remote.test.ts can check them. Nothing here logs, stores or sends an address:
// addresses are only classified, shown hidden (●●●) and revealed on the screen while the user asks.

export const DEFAULT_PORT = 47989; // server default (src/config.cpp), unchanged for existing installs
export const ARBS_PORT = 45989; // ARBS-H port family: new installs (installer writes port = 45989)
export const INPUT_MIN_PORT = 1029; // web input lower bound (web/configs/configFieldSchema.ts)
export const ACCEPTED_MIN_PORT = 1019; // still accepted by the server (1019..1028 with a warning)
export const MAX_PORT = 65514; // base + 21 <= 65535
export const USBIP_PORT = 3240;
export const SUNSHINE_FIRST = 47984; // Sunshine / Apollo / Vibepollo default family
export const SUNSHINE_LAST = 48010;
export const DYNAMIC_FIRST = 49152; // Windows dynamic port range
export const OFFSETS = { https: -5, http: 0, webUi: 1, rtsp: 21, video: 9, control: 10, audio: 11 } as const;

/** D11: STACKON (stackon.kr) router guide. Empty = the link is hidden (filled in later by the plan owner). */
export const STACKON_GUIDE_URL = '';
/** D6 / P8: outside port check page, opened by the browser only. Empty = hidden. */
export const EXTERNAL_CHECK_URL = '';
/** D1: official sites only. */
export const TAILSCALE_URL = 'https://tailscale.com/download';
export const TAILSCALE_CONNECTION_URL = 'https://tailscale.com/kb/1257/connection-types';
export const ZEROTIER_URL = 'https://www.zerotier.com/';
/** D11: router makers' own pages only (docs/research/NET1_WEB.md §2 ①). */
export const ROUTER_GUIDE_LINKS: readonly { id: 'asus' | 'tplink'; url: string }[] = [
  { id: 'asus', url: 'https://www.asus.com/kr/support/FAQ/1037906' },
  { id: 'tplink', url: 'https://www.tp-link.com/us/user-guides/archer-c80_v1/chapter-10-nat-forwarding' },
];

/** The only keys the wizard may PATCH (NET2 §2). wan_encryption_mode is only put back, never changed (D8). */
export const WIZARD_KEYS = [
  'upnp',
  'origin_web_ui_allowed',
  'port',
  'lan_encryption_mode',
  'wan_encryption_mode',
  'enable_pairing',
] as const;
export type WizardKey = (typeof WIZARD_KEYS)[number];

export function isWizardKey(key: string): key is WizardKey {
  return (WIZARD_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------
export interface PortEntry {
  port: number;
  role: 'https' | 'http' | 'rtsp' | 'video' | 'control' | 'audio';
}

/** Ports a remote client needs (same as the server's arbs_network_policy.h). The web UI port is not here. */
export function streamPorts(base: number): { tcp: PortEntry[]; udp: PortEntry[] } {
  return {
    tcp: [
      { port: base + OFFSETS.https, role: 'https' },
      { port: base + OFFSETS.http, role: 'http' },
      { port: base + OFFSETS.rtsp, role: 'rtsp' },
    ],
    udp: [
      { port: base + OFFSETS.video, role: 'video' },
      { port: base + OFFSETS.control, role: 'control' },
      { port: base + OFFSETS.audio, role: 'audio' },
    ],
  };
}

/** Never put into a router rule: the web UI port and USB/IP. */
export function neverOpen(base: number): { port: number; why: 'web_ui' | 'usbip' }[] {
  return [
    { port: base + OFFSETS.webUi, why: 'web_ui' },
    { port: USBIP_PORT, why: 'usbip' },
  ];
}

/** Every port ARBS-H opens for a base (TCP base-5, base, base+1, base+21, UDP base+9..11). */
export function allPorts(base: number): number[] {
  return Object.values(OFFSETS).map((offset) => base + offset);
}

export function overlapsSunshineDefault(base: number): boolean {
  return allPorts(base).some((p) => p >= SUNSHINE_FIRST && p <= SUNSHINE_LAST);
}

export function inDynamicRange(base: number): boolean {
  return base + OFFSETS.rtsp >= DYNAMIC_FIRST;
}

export function belowRecommended(base: number): boolean {
  return base >= ACCEPTED_MIN_PORT && base < INPUT_MIN_PORT;
}

/** Port the server really uses (src/config.cpp): missing / bad / out of 1019..65514 = 47989. */
export function effectivePort(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_PORT;
  const text = String(value).trim().replace(/^"(.*)"$/, '$1');
  if (!/^\d{1,5}$/.test(text)) return DEFAULT_PORT;
  const n = Number(text);
  return n >= ACCEPTED_MIN_PORT && n <= MAX_PORT ? n : DEFAULT_PORT;
}

export type PortError = 'not_number' | 'out_of_range';
export type PortWarning = 'overlaps_sunshine' | 'dynamic_range' | 'same_as_now';

export interface PortCheck {
  port: number | null;
  error: PortError | null;
  warnings: PortWarning[];
}

/** "포트 바꾸기" input check: blocked outside 1029..65514, warnings for the Sunshine family / dynamic range. */
export function checkPort(value: unknown, current: number): PortCheck {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return { port: null, error: 'not_number', warnings: [] };
  const port = Number(text);
  if (port < INPUT_MIN_PORT || port > MAX_PORT) return { port, error: 'out_of_range', warnings: [] };
  const warnings: PortWarning[] = [];
  if (overlapsSunshineDefault(port)) warnings.push('overlaps_sunshine');
  if (inDynamicRange(port)) warnings.push('dynamic_range');
  if (port === current) warnings.push('same_as_now');
  return { port, error: null, warnings };
}

// ---------------------------------------------------------------------------------------------
// Addresses: kinds and hiding (D4, D5)
// ---------------------------------------------------------------------------------------------
export const MASK = '●●●';

/** Kind of the address this page was opened with (location.hostname). */
export type HostKind = 'this_pc' | 'private' | 'cgnat' | 'public' | 'ipv6' | 'name';

function v4(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

export function hostKind(hostname: string): HostKind {
  const host = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return 'this_pc';
  const a = v4(host);
  if (a) {
    if (a[0] === 127) return 'this_pc';
    if (a[0] === 10 || (a[0] === 172 && a[1]! >= 16 && a[1]! <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 169 && a[1] === 254)) {
      return 'private';
    }
    if (a[0] === 100 && a[1]! >= 64 && a[1]! <= 127) return 'cgnat';
    return 'public';
  }
  if (host.includes(':')) return 'ipv6';
  return 'name';
}

/** A text that only shows ●●● when turned into a string, JSON or a console line; reveal() gives the value. */
export interface HiddenText {
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

export function hideText(value: string): HiddenText {
  const hidden = {
    reveal: () => value,
    toString: () => MASK,
    toJSON: () => MASK,
    [Symbol.for('nodejs.util.inspect.custom')]: () => MASK,
  };
  return Object.freeze(hidden);
}

/** What the screen shows: ●●● unless the user pressed "보기". */
export function shown(text: HiddenText | string, revealed: boolean): string {
  if (!revealed) return MASK;
  return typeof text === 'string' ? text : text.reveal();
}

/** Text to type into Moonlight: "address" for the default port, "address:port" otherwise ([v6]:port for IPv6). */
export function moonlightAddress(address: string, base: number): string {
  const ipv6 = address.includes(':');
  if (base === DEFAULT_PORT) return address;
  return ipv6 ? `[${address}]:${base}` : `${address}:${base}`;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics (GET /api/network/diagnostics, or a smaller view from /api/config only)
// ---------------------------------------------------------------------------------------------
export type ListenerState = 'not_started' | 'ok' | 'failed' | 'unknown';
export type IgdState = 'none' | 'connected' | 'private_ip' | 'disconnected' | 'unknown_device' | 'not_run';
export type WanKind = 'unknown' | 'public' | 'private' | 'cgnat';
export type InterfaceKind = 'private_v4' | 'cgnat_v4' | 'public_v4' | 'ipv6_global' | 'ipv6_ula' | 'link_local';

export interface RemoteInterface {
  kind: InterfaceKind;
  address: HiddenText;
  tailscaleLike: boolean;
}

export interface Diagnostics {
  source: 'server' | 'config';
  port: number;
  portNote: '' | 'below_1029' | 'overlaps_sunshine_default';
  listeners: Record<'nvhttp_http' | 'nvhttp_https' | 'confighttp' | 'rtsp' | 'stream', ListenerState>;
  upnp: { enabled: boolean; igd: IgdState; mappedOk: number; mappedTotal: number; pinhole: string; wanKind: WanKind };
  interfaces: RemoteInterface[];
  interfacesSupported: boolean;
  originWan: boolean;
}

const LISTENERS = ['nvhttp_http', 'nvhttp_https', 'confighttp', 'rtsp', 'stream'] as const;
const IGD: readonly IgdState[] = ['none', 'connected', 'private_ip', 'disconnected', 'unknown_device', 'not_run'];
const WAN: readonly WanKind[] = ['unknown', 'public', 'private', 'cgnat'];
const KINDS: readonly InterfaceKind[] = ['private_v4', 'cgnat_v4', 'public_v4', 'ipv6_global', 'ipv6_ula', 'link_local'];

function pick<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function serverBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  return ['true', 'yes', 'enable', 'enabled', 'on'].includes(text) || text.includes('1');
}

/** origin_web_ui_allowed as the server reads it (config.cpp string_restricted_f pc/lan/wan, anything else = default lan). */
export function originOf(config: Record<string, unknown>): 'pc' | 'lan' | 'wan' {
  const v = String(config.origin_web_ui_allowed ?? '').trim().toLowerCase();
  return v === 'pc' || v === 'wan' ? v : 'lan';
}

function portNoteOf(base: number): Diagnostics['portNote'] {
  if (base < INPUT_MIN_PORT) return 'below_1029';
  return overlapsSunshineDefault(base) ? 'overlaps_sunshine_default' : '';
}

/** Server reply -> typed model. Addresses are wrapped right away (never kept as plain strings). */
export function readDiagnostics(raw: unknown, config: Record<string, unknown>): Diagnostics {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const port = Number.isInteger(r.port) ? (r.port as number) : effectivePort(config.port);
  const states: readonly ListenerState[] = ['not_started', 'ok', 'failed', 'unknown'];
  const listeners = Object.fromEntries(LISTENERS.map((id) => [id, pick<ListenerState>(r.listeners?.[id], states, 'unknown')])) as Diagnostics['listeners'];
  const u = (r.upnp ?? {}) as Record<string, unknown>;
  const interfaces: RemoteInterface[] = Array.isArray(r.interfaces)
    ? r.interfaces
        .filter((i: any) => i && typeof i.address === 'string' && KINDS.includes(i.kind))
        .map((i: any) => ({ kind: i.kind as InterfaceKind, address: hideText(i.address), tailscaleLike: Boolean(i.tailscale_like) }))
    : [];
  return {
    source: 'server',
    port,
    portNote: pick(r.port_note, ['', 'below_1029', 'overlaps_sunshine_default'] as const, portNoteOf(port)),
    listeners,
    upnp: {
      enabled: typeof u.enabled === 'boolean' ? u.enabled : serverBool(config.upnp, false),
      igd: pick(u.igd, IGD, 'not_run'),
      mappedOk: Number(u.mapped_ok) || 0,
      mappedTotal: Number(u.mapped_total) || 0,
      pinhole: typeof u.ipv6_pinhole === 'string' ? u.ipv6_pinhole : 'not_tried',
      wanKind: pick(u.wan_kind, WAN, 'unknown'),
    },
    interfaces,
    interfacesSupported: Boolean(r.interfaces_supported),
    originWan: typeof r.risk?.origin_wan === 'boolean' ? r.risk.origin_wan : originOf(config) === 'wan',
  };
}

/** S1 not available (older server, error): what /api/config alone can tell. */
export function diagnosticsFromConfig(config: Record<string, unknown>): Diagnostics {
  const d = readDiagnostics({}, config);
  return { ...d, source: 'config' };
}

// ---------------------------------------------------------------------------------------------
// Step 1 checks (traffic lights) and step 2 recommendation
// ---------------------------------------------------------------------------------------------
export type Grade = 'good' | 'warn' | 'bad' | 'info';

export interface Check {
  id: 'listeners' | 'access' | 'upnp' | 'risk' | 'overlap' | 'low_port';
  grade: Grade;
  /** i18n key under remote. */
  text: string;
}

export function checks(d: Diagnostics, host: HostKind): Check[] {
  const out: Check[] = [];
  const states = Object.values(d.listeners);
  if (states.includes('failed')) out.push({ id: 'listeners', grade: 'bad', text: 'remote.c_listeners_failed' });
  else if (d.source === 'config' || states.includes('unknown')) out.push({ id: 'listeners', grade: 'info', text: 'remote.c_listeners_unknown' });
  else out.push({ id: 'listeners', grade: 'good', text: 'remote.c_listeners_ok' });

  out.push({ id: 'access', grade: host === 'public' ? 'warn' : 'info', text: `remote.c_access_${host}` });

  if (!d.upnp.enabled) out.push({ id: 'upnp', grade: 'info', text: 'remote.c_upnp_off' });
  else if (d.upnp.igd === 'not_run') out.push({ id: 'upnp', grade: 'info', text: 'remote.c_upnp_not_run' });
  else if (d.upnp.igd === 'connected' && d.upnp.mappedTotal > 0 && d.upnp.mappedOk === d.upnp.mappedTotal) {
    out.push({ id: 'upnp', grade: 'good', text: 'remote.c_upnp_ok' });
  } else if (d.upnp.igd === 'private_ip' || d.upnp.wanKind === 'private' || d.upnp.wanKind === 'cgnat') {
    out.push({ id: 'upnp', grade: 'warn', text: 'remote.c_upnp_private' });
  } else out.push({ id: 'upnp', grade: 'warn', text: 'remote.c_upnp_failed' });

  if (d.originWan && d.upnp.enabled) out.push({ id: 'risk', grade: 'bad', text: 'remote.c_risk_upnp_wan' });
  else if (d.originWan) out.push({ id: 'risk', grade: 'bad', text: 'remote.c_risk_wan' });
  else out.push({ id: 'risk', grade: 'good', text: 'remote.c_risk_ok' });

  out.push(
    overlapsSunshineDefault(d.port)
      ? { id: 'overlap', grade: 'warn', text: 'remote.c_overlap' }
      : { id: 'overlap', grade: 'good', text: 'remote.c_overlap_none' },
  );
  if (d.portNote === 'below_1029' || belowRecommended(d.port)) out.push({ id: 'low_port', grade: 'warn', text: 'remote.c_low_port' });
  return out;
}

export type Answer = 'yes' | 'no' | 'unknown';
export interface Recommendation {
  method: 'tailscale' | 'forward';
  notes: ('already_tailscale' | 'wan_not_public' | 'unknown_means_tailscale')[];
}

/** NET1 §8 step 2: two questions; anything not "yes, yes" (or a router WAN that is not public) = Tailscale. */
export function recommend(router: Answer, wanPublic: Answer, host: HostKind, wan: WanKind): Recommendation {
  const notes: Recommendation['notes'] = [];
  if (host === 'cgnat') notes.push('already_tailscale');
  if (wan === 'private' || wan === 'cgnat') notes.push('wan_not_public');
  if (router === 'unknown' || wanPublic === 'unknown') notes.push('unknown_means_tailscale');
  const forward = router === 'yes' && wanPublic === 'yes' && !notes.includes('wan_not_public');
  return { method: forward ? 'forward' : 'tailscale', notes };
}

/** S3 on the screen: turning UPnP on while the web UI accepts the internet (origin = wan) is blocked. */
export function upnpBlockReason(originWan: boolean): string | null {
  return originWan ? 'remote.upnp_blocked_wan' : null;
}

// ---------------------------------------------------------------------------------------------
// Changes the wizard makes (PATCH body, before/after list, prev_port carried across the port change)
// ---------------------------------------------------------------------------------------------
const VALUES: Record<WizardKey, readonly string[]> = {
  upnp: ['enabled', 'disabled'],
  origin_web_ui_allowed: ['pc', 'lan'], // never "wan" from the wizard
  port: [],
  lan_encryption_mode: ['0', '1'],
  wan_encryption_mode: [], // D8: shown only, never changed (put back only)
  enable_pairing: ['enabled', 'disabled'],
};

/**
 * S3 for "이전 값으로": the settings after writing `value` back to `key` ('' = no line = server default).
 * Returns the reason when the result would be UPnP on + management page allowed from the internet (origin = wan),
 * in both directions (origin back to wan while UPnP is on, UPnP back on while origin is wan). `originWanNow` is the
 * running server's origin (diagnostics), counted too when the key is not origin itself. Other keys are never blocked.
 */
export function restoreBlockReason(
  key: string,
  value: string,
  current: Record<string, unknown>,
  originWanNow = false,
): string | null {
  if (key !== 'upnp' && key !== 'origin_web_ui_allowed') return null; // other keys never make this combination
  const next: Record<string, unknown> = { ...current };
  if (value === '') delete next[key];
  else next[key] = value;
  const wan = originOf(next) === 'wan' || (key !== 'origin_web_ui_allowed' && originWanNow);
  if (!wan || !serverBool(next.upnp, false)) return null;
  return key === 'upnp' ? 'remote.revert_blocked_upnp' : 'remote.revert_blocked_origin';
}

/**
 * PATCH /api/config body for one wizard change. Throws for a key outside WIZARD_KEYS or a value the wizard does not
 * offer. restore = "이전 값으로": the value recorded before the change is written back as is ('' removes the key,
 * i.e. the server default), but only with the current settings and never into UPnP on + origin = wan (S3).
 */
export function wizardPatch(
  key: string,
  value: string,
  restore = false,
  current?: Record<string, unknown>,
  originWanNow = false,
): Record<string, string> {
  if (!isWizardKey(key)) throw new Error(`not a wizard key: ${key}`);
  if (restore) {
    if (!current) throw new Error('restore needs the current settings');
    if (restoreBlockReason(key, value, current, originWanNow)) throw new Error('restore blocked: UPnP with origin wan');
    return { [key]: value };
  }
  if (key === 'port') {
    const check = checkPort(value, -1);
    if (check.error) throw new Error(`bad port: ${check.error}`);
    return { port: String(check.port) };
  }
  if (!VALUES[key].includes(value)) throw new Error(`value not offered for ${key}`);
  return { [key]: value };
}

export interface Change {
  key: WizardKey;
  /** value in sunshine.conf before the first change ('' = no line = server default) */
  before: string;
  after: string;
}

/** Keeps the first "before" when the same key changes twice; drops the entry once it is back to its first value. */
export function recordChange(list: Change[], key: WizardKey, before: string, after: string): Change[] {
  const old = list.find((c) => c.key === key);
  const first = old ? old.before : before;
  const rest = list.filter((c) => c.key !== key);
  return first === after ? rest : [...rest, { key, before: first, after }];
}

export const CHANGES_KEY = 'arbs.remote.changes';

export function readChanges(text: string | null): Change[] {
  try {
    const list = JSON.parse(text ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (c): c is Change => c && isWizardKey(c.key) && typeof c.before === 'string' && typeof c.after === 'string',
    );
  } catch {
    return [];
  }
}

/** ?prev_port= from the new web UI link after a port change (a port number, never an address). */
export function parsePrevPort(value: unknown): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= ACCEPTED_MIN_PORT && n <= MAX_PORT ? n : null;
}

/** Web UI address after a port change: same host name, port new + 1, back on step 5 with the old port. */
export function newWebUiUrl(hostname: string, newBase: number, prevBase: number): string {
  return `https://${hostname}:${newBase + OFFSETS.webUi}/arbs/remote?step=5&prev_port=${prevBase}`;
}

export const STEPS = ['0', '1', '2', '3a', '3b', '3c', '3d', '4', '5'] as const;
export type Step = (typeof STEPS)[number];

export function parseStep(value: unknown): Step {
  const text = Array.isArray(value) ? value[0] : value;
  return (STEPS as readonly unknown[]).includes(text) ? (text as Step) : '0';
}
