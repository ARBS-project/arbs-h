// ARBS-H UI1b: D-UI-3 disable rules (docs/analysis/UI1b.md §3, R1-R14).
// A lower control that needs an upper choice stays disabled with a one-line reason.
// Each function returns the i18n key of the reason, or null when the control is usable.
// Pure functions, unit-tested in scripts/rules.test.ts.

import { effectiveGamepad } from './config.ts';

export type Reason = string | null;

export const ARBS_GAMEPAD = 'usbip_ds5';

/** R1: not signed in or no administrator account yet. */
export function authReason(auth: { credentials_configured: boolean; login_required: boolean }): Reason {
  if (!auth.credentials_configured) return 'reason.need_account';
  if (auth.login_required) return 'reason.need_login';
  return null;
}

/** R2: the heartbeat to ARBS-H failed. */
export function offlineReason(online: boolean): Reason {
  return online ? null : 'reason.offline';
}

/** First non-null reason (rules are checked in the order given). */
export function firstReason(...reasons: Reason[]): Reason {
  for (const reason of reasons) if (reason) return reason;
  return null;
}

export interface DeviceLike {
  uuid: string;
  connected: boolean;
}

/** R3: no device chosen -> disconnect, unpair, name, permissions, sleep. */
export function deviceSelectReason(device: DeviceLike | null | undefined): Reason {
  return device ? null : 'reason.pick_device';
}

/** R3 + R4: disconnect also needs the device to be connected now. */
export function disconnectReason(device: DeviceLike | null | undefined): Reason {
  return firstReason(deviceSelectReason(device), device && !device.connected ? 'reason.device_offline' : null);
}

/** R5: no app chosen -> edit, delete, launch, close, name, command, cover, HD haptics. */
export function appSelectReason(selected: boolean): Reason {
  return selected ? null : 'reason.pick_app';
}

export interface ControllerState {
  controller: boolean;
  gamepad: string;
}

/** R6: gamepad input off -> gamepad type, rumble, haptics gain, trigger status. */
export function controllerOffReason(state: ControllerState): Reason {
  return state.controller ? null : 'reason.controller_off';
}

/**
 * H021 (EA-H021-R-03, plan A): gamepad types for which the server builds the usbip DualSense for
 * an APEX (reported as a PlayStation pad) when usbip-win2 is installed, so arbs_trigger_status and
 * the HD haptics gain apply (src/platform/windows/dualsense_usbip_gamepad_policy.h:24-26,
 * vhf_gamepad_policy.cpp:70-119; docs/analysis/H021.md §1-1). Exact server names (lower case).
 */
export const DUALSENSE_GAMEPADS: readonly string[] = ['usbip_ds5', 'auto', 'vhf', 'vhf_ds5', 'vhf_steam'];

export function makesDualSense(gamepad: string): boolean {
  return DUALSENSE_GAMEPADS.includes(gamepad);
}

/**
 * R7 (H021): trigger status and HD haptics gain only apply when the pad becomes a DualSense.
 * The values themselves are never changed here, the controls are only disabled with the reason.
 */
export function dualSenseReason(state: ControllerState): Reason {
  return firstReason(controllerOffReason(state), makesDualSense(effectiveGamepad(state.gamepad)) ? null : 'reason.need_dualsense');
}

/**
 * Per-app "DualSense HD haptics" (H-APP-22) makes a DualSense for that app whatever the gamepad
 * type is (policy.h:24 application_requested, process.cpp:2444-2450), so only R6 applies.
 */
export function appHapticsReason(state: ControllerState): Reason {
  return controllerOffReason(state);
}

/** H021 stats: "keep session history" cannot change while a stream is active (the server defers it). */
export function historyToggleReason(activeStream: boolean): Reason {
  return activeStream ? 'reason.streaming_now' : null;
}

/** R8: nothing running -> force close, stop stream. */
export function runningReason(session: { appRunning?: boolean; activeSessions?: number } | null): Reason {
  if (session && (session.appRunning || (session.activeSessions ?? 0) > 0)) return null;
  return 'reason.nothing_running';
}

/** R9: no display snapshot -> replace, delete snapshot. */
export function snapshotReason(golden: { exists?: boolean } | null): Reason {
  return golden?.exists ? null : 'reason.no_snapshot';
}

/** R10: no crash dump -> crash bundle download. */
export function crashReason(manifestParts: number): Reason {
  return manifestParts > 0 ? null : 'reason.no_crash';
}

/** R11: nothing changed -> save, discard. */
export function unchangedReason(changedCount: number): Reason {
  return changedCount > 0 ? null : 'reason.no_changes';
}

/** R12: pairing form. PIN is 1-4 digits (zero-padded on send) and a name is required. */
export function pairReason(name: string, pin: string): Reason {
  if (!name.trim()) return 'reason.need_device_name';
  if (!/^\d{1,4}$/.test(pin)) return 'reason.need_pin';
  return null;
}

/** R12: password change form. */
export function passwordReason(form: { newUsername: string; newPassword: string; confirmPassword: string }): Reason {
  if (!form.newUsername.trim()) return 'reason.need_username';
  if (!form.newPassword) return 'reason.need_password';
  if (form.newPassword !== form.confirmPassword) return 'reason.password_mismatch';
  return null;
}

/** R12: app form needs a name. */
export function appNameReason(name: string): Reason {
  return name.trim() ? null : 'reason.need_app_name';
}

/** R13: no search text -> previous/next match. */
export function searchReason(query: string, matches: number): Reason {
  if (!query.trim()) return 'reason.need_search';
  return matches > 0 ? null : 'reason.no_match';
}

/** R14: Windows-only areas (service start mode, virtual display card). */
export function isWindows(platform: string | undefined | null): boolean {
  return (platform ?? '').toLowerCase().includes('windows');
}
