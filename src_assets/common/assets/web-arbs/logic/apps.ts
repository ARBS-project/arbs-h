// ARBS-H UI1b: app list helpers (H-APP-*, H-V2LIB-03, H-V2APP-*).
// The server finds the edited app by uuid (src/confighttp.cpp saveApp), so an edit is
// merged into the latest record from GET /api/apps and the whole record is sent back.

export type AppRecord = Record<string, unknown> & { uuid?: string; name?: string };

export interface AppEdit {
  name: string;
  cmd: string;
  imagePath: string;
  elevated: boolean;
  dualsenseHaptics: boolean;
}

/** System apps that the server can restore (POST /api/apps/system/{id}/restore). */
export const SYSTEM_APPS = ['desktop', 'monitor', 'input'] as const;

const TRANSIENT = ['id', 'index', 'image-version', 'playnite-icon-version', 'remote-session'];

export function appsFrom(payload: unknown): AppRecord[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { apps?: unknown }).apps)
      ? (payload as { apps: unknown[] }).apps
      : [];
  return list.filter((a): a is AppRecord => Boolean(a && typeof a === 'object' && !Array.isArray(a)));
}

export function appUuid(app: AppRecord | null | undefined): string {
  return app && typeof app.uuid === 'string' ? app.uuid : '';
}

export function commandText(cmd: unknown): string {
  if (Array.isArray(cmd)) return cmd.filter((v) => typeof v === 'string').join(' ');
  return typeof cmd === 'string' ? cmd : '';
}

export function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function editFrom(app: AppRecord | null | undefined): AppEdit {
  return {
    name: typeof app?.name === 'string' ? app.name : '',
    cmd: commandText(app?.cmd),
    imagePath: typeof app?.['image-path'] === 'string' ? (app['image-path'] as string) : '',
    elevated: asBool(app?.elevated),
    dualsenseHaptics: asBool(app?.['dualsense-haptics']),
  };
}

/**
 * H021: the 4 apps that come with the install (docs/analysis/H021.md §1-3).
 * - desktop, steam_bp: src_assets/windows/assets/apps.json (copied on first start).
 * - input, monitor: added by the server itself; GET /api/apps marks them with
 *   "remote-session" (src/confighttp.cpp getApps).
 * Desktop is matched by name like the server does (renamed = no longer the default app).
 */
export type DefaultAppKind = 'desktop' | 'steam_bp' | 'input' | 'monitor';
export const DEFAULT_APP_KINDS: readonly DefaultAppKind[] = ['desktop', 'steam_bp', 'input', 'monitor'];
/** Default apps that are Vibepollo features and have nothing to do with ARBS haptics. */
export const NOT_ARBS_APPS: readonly DefaultAppKind[] = ['input', 'monitor'];

export function defaultAppKind(app: AppRecord | null | undefined): DefaultAppKind | null {
  if (!app) return null;
  if (app['remote-session'] === 'input') return 'input';
  if (app['remote-session'] === 'monitor') return 'monitor';
  if (app.name === 'Desktop') return 'desktop';
  const detached = Array.isArray(app.detached) ? app.detached : [];
  if (app.name === 'Steam Big Picture' && detached.some((d) => typeof d === 'string' && d.includes('steam://open/bigpicture')))
    return 'steam_bp';
  return null;
}

export type AppBadge = 'playnite' | 'steam' | 'lutris' | 'default' | 'custom';
export function appBadge(app: AppRecord): AppBadge {
  if (app['playnite-id']) return 'playnite';
  if (app['steam-id']) return 'steam';
  if (app['lutris-id']) return 'lutris';
  if (defaultAppKind(app)) return 'default';
  return 'custom';
}

/**
 * System apps that "restore default apps" may bring back now. The server lists the missing ones
 * in "restorable-system-apps" ([{id, name}]); restoring one that exists fails (400). When an
 * older server sends no list, all three stay available (old behaviour).
 */
export function restorableSystemApps(payload: unknown): Set<(typeof SYSTEM_APPS)[number]> {
  const list =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { 'restorable-system-apps'?: unknown })['restorable-system-apps']
      : undefined;
  if (!Array.isArray(list)) return new Set(SYSTEM_APPS);
  const ids = list
    .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined))
    .filter((id): id is (typeof SYSTEM_APPS)[number] => (SYSTEM_APPS as readonly unknown[]).includes(id));
  return new Set(ids);
}
export function isManaged(app: AppRecord): boolean {
  return typeof app['playnite-managed'] === 'string' && app['playnite-managed'] !== '';
}

/** Body for POST /api/apps. `base` null = new app (index -1, the server makes the uuid). */
export function savePayload(base: AppRecord | null, edit: AppEdit): AppRecord {
  const payload: AppRecord = base ? structuredClone(base) : { index: -1 };
  if (base) for (const field of TRANSIENT) delete payload[field];
  payload.name = edit.name.trim();
  payload.cmd = edit.cmd.trim();
  payload['image-path'] = edit.imagePath.trim();
  payload.elevated = edit.elevated;
  payload['dualsense-haptics'] = edit.dualsenseHaptics;
  payload['prep-cmd'] = Array.isArray(payload['prep-cmd']) ? payload['prep-cmd'] : [];
  payload.detached = Array.isArray(payload.detached) ? payload.detached : [];
  return payload;
}

/** New uuid order after moving one app up (-1) or down (+1). */
export function moveOrder(uuids: string[], uuid: string, direction: -1 | 1): string[] {
  const from = uuids.indexOf(uuid);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= uuids.length) return uuids.slice();
  const next = uuids.slice();
  next.splice(from, 1);
  next.splice(to, 0, uuid);
  return next;
}

/** "Show more" paging (H-V2LIB-03): visible slice size. */
export function visibleCount(total: number, pages: number, pageSize = 12): number {
  return Math.min(total, Math.max(1, pages) * pageSize);
}
