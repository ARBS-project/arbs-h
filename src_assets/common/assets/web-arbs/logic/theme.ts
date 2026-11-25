// ARBS-H UI1b: theme preference (light / dark / system), saved in localStorage "arbs.theme".
// Storage can be disabled (private mode, policies), so every access is wrapped in try/catch.
// public/assets/theme-boot.js applies the same rule before the app loads.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'arbs.theme';
export const DEFAULT_THEME: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readTheme(storage: Pick<Storage, 'getItem'> | null | undefined): ThemePreference {
  try {
    const value = storage?.getItem(THEME_KEY);
    return isThemePreference(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Returns false when the value could not be saved (the choice still applies for this page). */
export function writeTheme(storage: Pick<Storage, 'setItem'> | null | undefined, value: ThemePreference): boolean {
  if (!isThemePreference(value)) return false;
  try {
    if (!storage) return false;
    storage.setItem(THEME_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}
