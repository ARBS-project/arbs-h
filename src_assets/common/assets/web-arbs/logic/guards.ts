// ARBS-H UI1b: direct-address guard (docs/analysis/UI1b.md §3 "직접 주소 진입 → 상위로").
// A sub page whose upper choice is missing sends the user back to the upper page.

export interface GuardInput {
  path: string;
  signedIn: boolean;
  /** Known device uuids, or null when the list could not be read. */
  deviceIds: string[] | null;
  /** Known app uuids, or null when the list could not be read. */
  appIds: string[] | null;
}

export interface GuardResult {
  redirect: string;
  notice: 'missing_device' | 'missing_app' | 'sign_in_first' | 'not_found';
}

const KNOWN_TOP = new Set(['/', '/devices', '/controller', '/display', '/apps', '/troubleshoot', '/account']);

/** Path is relative to the router base (/arbs/). Returns null when the page may open. */
export function guardRoute(input: GuardInput): GuardResult | null {
  const path = input.path.replace(/\/+$/, '') || '/';
  if (KNOWN_TOP.has(path)) return null;

  const device = /^\/devices\/([^/]+)$/.exec(path);
  if (device) {
    if (!input.signedIn) return { redirect: '/devices', notice: 'sign_in_first' };
    if (device[1] === 'pair') return null;
    const uuid = decodeURIComponent(device[1]!);
    if (!input.deviceIds || !input.deviceIds.includes(uuid)) return { redirect: '/devices', notice: 'missing_device' };
    return null;
  }

  const app = /^\/apps\/([^/]+)$/.exec(path);
  if (app) {
    if (!input.signedIn) return { redirect: '/apps', notice: 'sign_in_first' };
    if (app[1] === 'new') return null;
    const uuid = decodeURIComponent(app[1]!);
    if (!input.appIds || !input.appIds.includes(uuid)) return { redirect: '/apps', notice: 'missing_app' };
    return null;
  }

  return { redirect: '/', notice: 'not_found' };
}
