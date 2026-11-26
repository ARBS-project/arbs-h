// ARBS-H UI1b: the settings this UI edits, how they are read from GET /api/config
// (string values from sunshine.conf, missing key = server default) and how the
// PATCH /api/config body is built (changed keys only, values limited to the choices).

export const TRIGGER_STATUS = ['h2b', 'enabled', 'disabled'] as const;
export type TriggerStatus = (typeof TRIGGER_STATUS)[number];

/**
 * H021: trigger status choices shown in the ARBS WebUI. h2b is the normal choice, "disabled" is
 * offered in the advanced part ("끄기(문제 있을 때만)"), "enabled" had no effect in the field
 * tests (EA-B3b-U-01) and is hidden. The current value is always shown so nothing changes by itself.
 */
export function triggerOptions(current: TriggerStatus): TriggerStatus[] {
  return current === 'h2b' ? ['h2b'] : ['h2b', current];
}

export const WEBUI_DEFAULTS = ['arbs', 'classic', 'v2'] as const;
export type WebUiDefault = (typeof WEBUI_DEFAULTS)[number];

export const VIRTUAL_DISPLAY_MODES = ['per_client', 'shared', 'disabled'] as const;
export const RESOLUTION_OPTIONS = ['auto', 'manual', 'disabled'] as const;

/** Server list (src/platform/windows/input.cpp supported_gamepads). usbip_ds5 = ARBS. */
export const GAMEPAD_TYPES = [
  'usbip_ds5',
  'auto',
  'x360',
  'ds4',
  'vhf',
  'vhf_xbox',
  'vhf_xbox_one',
  'vhf_ds4',
  'vhf_ds5',
  'vhf_switch',
  'vhf_steam',
] as const;

/**
 * H021 (docs/analysis/H021.md §4-1, EA-H021-U-01): gamepad types listed in the ARBS WebUI. Only the
 * ones confirmed for ARBS so far; the others are not deleted (server and classic UI keep them) and
 * get added back here once tested. usbip_ds5 first = "ARBS 권장(모든 기능)".
 */
export const ARBS_GAMEPAD_LIST: readonly string[] = ['usbip_ds5', 'auto'];

/** Value the server really uses: an unknown name is ignored and the default "auto" stays (config.cpp string_restricted_f). */
export function effectiveGamepad(value: string): string {
  return (GAMEPAD_TYPES as readonly string[]).includes(value) ? value : 'auto';
}

/** The current value is not in the ARBS WebUI list (shown as is, with the "not confirmed" note). */
export function isHiddenGamepad(value: string): boolean {
  return !ARBS_GAMEPAD_LIST.includes(value);
}

export interface GamepadOption {
  value: string;
  /** Not in the ARBS list; only shown because it is the current value. */
  hidden: boolean;
}

/** Options for the gamepad type select: the ARBS list, plus the current value at the end when hidden. */
export function gamepadOptions(current: string): GamepadOption[] {
  const list: GamepadOption[] = ARBS_GAMEPAD_LIST.map((value) => ({ value, hidden: false }));
  if (isHiddenGamepad(current)) list.push({ value: current, hidden: true });
  return list;
}

export interface ArbsSettings {
  controller: boolean;
  forward_rumble: boolean;
  gamepad: string;
  dualsense_haptics_gain: number;
  arbs_trigger_status: TriggerStatus;
  arbs_enet_precise_time: boolean;
  virtual_display_mode: string;
  dd_resolution_option: string;
  arbs_webui_default: WebUiDefault;
  /** H021 stats (H-SET-173/174): keep the session history, and for how many days (0 = always). */
  session_history_enabled: boolean;
  session_history_ttl_days: number;
}

export type SettingKey = keyof ArbsSettings;
export const SETTING_KEYS: SettingKey[] = [
  'controller',
  'forward_rumble',
  'gamepad',
  'dualsense_haptics_gain',
  'arbs_trigger_status',
  'arbs_enet_precise_time',
  'virtual_display_mode',
  'dd_resolution_option',
  'arbs_webui_default',
  'session_history_enabled',
  'session_history_ttl_days',
];

/** Server defaults when the key is missing (src/config.cpp). */
export const DEFAULTS: ArbsSettings = {
  controller: true,
  forward_rumble: true,
  gamepad: 'auto',
  dualsense_haptics_gain: 1.0,
  arbs_trigger_status: 'h2b',
  arbs_enet_precise_time: true,
  virtual_display_mode: 'per_client',
  dd_resolution_option: 'auto',
  arbs_webui_default: 'arbs',
  session_history_enabled: true,
  session_history_ttl_days: 0,
};

/** Keys whose change needs an ARBS-H restart (or a controller reconnect) to take effect. */
export const RESTART_KEYS: SettingKey[] = ['arbs_trigger_status', 'arbs_enet_precise_time'];

/** Same truth table as src/config.cpp to_bool. */
export function serverBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  return ['true', 'yes', 'enable', 'enabled', 'on'].includes(text) || text.includes('1');
}

/** Same rule as src/arbs_trigger_status.h setting_from: "h2b" (any case), else to_bool. */
export function parseTriggerStatus(value: unknown): TriggerStatus {
  if (value === undefined || value === null || String(value).trim() === '') return 'h2b';
  if (String(value).trim().toLowerCase() === 'h2b') return 'h2b';
  return serverBool(value, false) ? 'enabled' : 'disabled';
}

export function parseWebUiDefault(value: unknown): WebUiDefault {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (WEBUI_DEFAULTS as readonly string[]).includes(text) ? (text as WebUiDefault) : 'arbs';
}

export function clampGain(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.dualsense_haptics_gain;
  return Math.round(Math.min(4, Math.max(0, n)) * 10) / 10;
}

/** Whole days >= 0 (config.cpp int_between_f {0, INT_MAX}); bad text = 0 (keep always). */
export function clampDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 36500);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function readSettings(config: Record<string, unknown>): ArbsSettings {
  return {
    controller: serverBool(config.controller, DEFAULTS.controller),
    forward_rumble: serverBool(config.forward_rumble, DEFAULTS.forward_rumble),
    gamepad: text(config.gamepad, DEFAULTS.gamepad),
    dualsense_haptics_gain:
      config.dualsense_haptics_gain === undefined || config.dualsense_haptics_gain === ''
        ? DEFAULTS.dualsense_haptics_gain
        : clampGain(config.dualsense_haptics_gain),
    arbs_trigger_status: parseTriggerStatus(config.arbs_trigger_status),
    arbs_enet_precise_time: serverBool(config.arbs_enet_precise_time, DEFAULTS.arbs_enet_precise_time),
    virtual_display_mode: text(config.virtual_display_mode, DEFAULTS.virtual_display_mode),
    dd_resolution_option: text(config.dd_resolution_option, DEFAULTS.dd_resolution_option),
    arbs_webui_default: parseWebUiDefault(config.arbs_webui_default),
    session_history_enabled: serverBool(config.session_history_enabled, DEFAULTS.session_history_enabled),
    session_history_ttl_days:
      config.session_history_ttl_days === undefined || config.session_history_ttl_days === ''
        ? DEFAULTS.session_history_ttl_days
        : clampDays(config.session_history_ttl_days),
  };
}

export function changedKeys(original: ArbsSettings, draft: ArbsSettings): SettingKey[] {
  return SETTING_KEYS.filter((key) => original[key] !== draft[key]);
}

/** One value as written to sunshine.conf. Booleans use enabled/disabled like the classic UI. */
export function serialize(key: SettingKey, value: ArbsSettings[SettingKey]): string {
  switch (key) {
    case 'controller':
    case 'forward_rumble':
    case 'arbs_enet_precise_time':
    case 'session_history_enabled':
      return value ? 'enabled' : 'disabled';
    case 'session_history_ttl_days':
      return String(clampDays(value));
    case 'dualsense_haptics_gain':
      return clampGain(value).toFixed(1);
    case 'arbs_trigger_status':
      return (TRIGGER_STATUS as readonly string[]).includes(String(value)) ? String(value) : 'h2b';
    case 'arbs_webui_default':
      return parseWebUiDefault(value);
    case 'virtual_display_mode':
      return (VIRTUAL_DISPLAY_MODES as readonly string[]).includes(String(value)) ? String(value) : 'per_client';
    case 'dd_resolution_option':
      return (RESOLUTION_OPTIONS as readonly string[]).includes(String(value)) ? String(value) : 'auto';
    case 'gamepad':
      return (GAMEPAD_TYPES as readonly string[]).includes(String(value)) ? String(value) : 'auto';
  }
}

/** PATCH /api/config body with only the changed keys. */
export function patchBody(original: ArbsSettings, draft: ArbsSettings, only?: SettingKey[]): Record<string, string> {
  const body: Record<string, string> = {};
  for (const key of changedKeys(original, draft)) {
    if (only && !only.includes(key)) continue;
    body[key] = serialize(key, draft[key]);
  }
  return body;
}

export function needsRestart(keys: SettingKey[]): boolean {
  return keys.some((key) => RESTART_KEYS.includes(key));
}

export interface PatchResult {
  status?: boolean;
  appliedNow?: boolean;
  deferred?: boolean;
  restartRequired?: boolean;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'deferred' | 'restart' | 'error';

/** Save-bar state after a PATCH (H-NAV-10). */
export function saveStateAfter(result: PatchResult, savedKeys: SettingKey[]): SaveState {
  if (result.status === false) return 'error';
  if (result.restartRequired || needsRestart(savedKeys)) return 'restart';
  if (result.deferred) return 'deferred';
  return 'saved';
}
