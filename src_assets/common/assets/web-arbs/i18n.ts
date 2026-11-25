// ARBS-H UI1b: Korean (default) and English, bundled (no extra static route needed).
// Same vue-i18n setup as the v2 UI (composition mode).
import { createI18n } from 'vue-i18n';

import en from '@/locales/en.json';
import ko from '@/locales/ko.json';
import { pickLocale, readLang, type ArbsLocale } from '@/logic/lang';

async function serverLocale(): Promise<string> {
  try {
    const response = await fetch('/api/configLocale', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';
    const payload = (await response.json()) as { locale?: string };
    return payload.locale ?? '';
  } catch {
    return '';
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function createArbsI18n() {
  const locale: ArbsLocale = pickLocale(readLang(storage()), await serverLocale());
  document.documentElement.lang = locale;
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'ko',
    fallbackWarn: false,
    missingWarn: false,
    messages: { ko, en },
  });
}
