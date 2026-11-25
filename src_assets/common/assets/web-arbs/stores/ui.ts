// ARBS-H UI1b: theme (localStorage "arbs.theme") and short notices.
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { readTheme, resolveTheme, writeTheme, type ThemePreference } from '@/logic/theme';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemePreference>(readTheme(safeStorage()));
  const resolved = ref(resolveTheme(theme.value, systemDark()));
  const notice = ref('');
  const noticeTone = ref<'info' | 'error'>('info');
  const navOpen = ref(false);
  let noticeTimer: number | undefined;

  function applyTheme(): void {
    resolved.value = resolveTheme(theme.value, systemDark());
    document.documentElement.setAttribute('data-theme', resolved.value);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved.value === 'dark' ? '#0c0a09' : '#c2410c');
  }

  function setTheme(value: ThemePreference): void {
    theme.value = value;
    writeTheme(safeStorage(), value);
    applyTheme();
  }

  function say(message: string, tone: 'info' | 'error' = 'info'): void {
    notice.value = message;
    noticeTone.value = tone;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.value = ''), 6000);
  }

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme.value === 'system') applyTheme();
    });
  } catch {
    /* old browser */
  }

  return { theme, resolved, notice, noticeTone, navOpen, applyTheme, setTheme, say };
});
