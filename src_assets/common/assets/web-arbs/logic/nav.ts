// ARBS-H 0.2.1 (H021): side menu groups. A group has a title (a heading, not clickable) and
// links. Pure data + helper so scripts/nav.test.ts can check the structure.

export interface NavItem {
  to: string;
  label: string;
  /** Feature ID carried by the link (data-feature), '' = none. */
  feature: string;
}

export interface NavGroup {
  id: 'home' | 'connect' | 'settings' | 'manage';
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'nav.group_home',
    items: [{ to: '/', label: 'nav.status', feature: 'H-NAV-01' }],
  },
  {
    id: 'connect',
    label: 'nav.group_connect',
    items: [
      { to: '/devices', label: 'nav.devices', feature: 'H-NAV-03' },
      { to: '/apps', label: 'nav.apps', feature: 'H-NAV-02' },
      // ARBS-H 0.3.0 (NET2, D12): remote access wizard in the "connect" group.
      { to: '/remote', label: 'nav.remote', feature: '' },
    ],
  },
  {
    id: 'settings',
    label: 'nav.group_settings',
    items: [
      { to: '/controller', label: 'nav.controller', feature: '' },
      { to: '/display', label: 'nav.display', feature: '' },
    ],
  },
  {
    id: 'manage',
    label: 'nav.group_manage',
    items: [
      { to: '/stats', label: 'nav.stats', feature: '' },
      { to: '/troubleshoot', label: 'nav.troubleshoot', feature: 'H-NAV-07' },
      { to: '/account', label: 'nav.account', feature: '' },
    ],
  },
];

/** The menu item for `to` is the current page (exact for "/", prefix for the others). */
export function isCurrent(path: string, to: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}
