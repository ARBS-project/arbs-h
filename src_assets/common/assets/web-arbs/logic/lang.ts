// ARBS-H UI1b: language choice. Korean is the default; English when chosen or when the
// server locale (GET /api/configLocale) is English. Saved in localStorage "arbs.lang".

export type ArbsLocale = 'ko' | 'en';
export const LANG_KEY = 'arbs.lang';

export function pickLocale(saved: unknown, serverLocale: unknown): ArbsLocale {
  if (saved === 'ko' || saved === 'en') return saved;
  if (typeof serverLocale === 'string' && /^en(?:_[A-Z]{2})?$/.test(serverLocale.trim())) return 'en';
  return 'ko';
}

export function readLang(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  try {
    return storage?.getItem(LANG_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLang(storage: Pick<Storage, 'setItem'> | null | undefined, value: ArbsLocale): void {
  try {
    storage?.setItem(LANG_KEY, value);
  } catch {
    /* storage disabled */
  }
}
