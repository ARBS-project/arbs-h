// ARBS-H UI1b: D-UI-3 disable rules (docs/analysis/UI1b.md §3, R1-R14).
// A lower control that needs an upper choice stays disabled with a one-line reason.
// Each function returns the i18n key of the reason, or null when the control is usable.
// Pure functions, unit-tested in scripts/rules.test.ts.

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

/** R7: gamepad is not usbip_ds5 -> trigger status, HD haptics gain, per-app HD haptics. */
export function dualSenseReason(state: ControllerState): Reason {
  return firstReason(controllerOffReason(state), state.gamepad === ARBS_GAMEPAD ? null : 'reason.need_usbip_ds5');
}

/** True when the warning next to the gamepad type must show (R7). */
export function gamepadWarning(state: ControllerState): boolean {
  return state.controller && state.gamepad !== ARBS_GAMEPAD;
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
