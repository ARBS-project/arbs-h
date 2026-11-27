<script setup lang="ts">
// ARBS-H UI1b: fixed top bar. Theme switch (H-NAV-11), UI switch links (H-HOME-04, H-V2NAV-06),
// "전체 설정(기존 화면)" (H-NAV-06), language.
import { useI18n } from 'vue-i18n';

import { writeLang, type ArbsLocale } from '@/logic/lang';
import type { ThemePreference } from '@/logic/theme';
import { useUiStore } from '@/stores/ui';

const { t, locale } = useI18n();
const ui = useUiStore();
const themes: ThemePreference[] = ['light', 'dark', 'system'];
// Served by ARBS-H from /arbs/images/ (public folder, not bundled), so it is bound instead of imported. 0.3.1: ARBS logo.
const logo = '/arbs/images/arbs-logo.svg';

function setLang(value: ArbsLocale): void {
  locale.value = value;
  document.documentElement.lang = value;
  try {
    writeLang(window.localStorage, value);
  } catch {
    /* storage disabled */
  }
}
</script>

<template>
  <header class="topbar">
    <button
      class="topbar__menu button button--ghost"
      type="button"
      :aria-expanded="ui.navOpen"
      aria-controls="arbs-nav"
      @click="ui.navOpen = !ui.navOpen"
    >
      {{ t('top.menu') }}
    </button>
    <a class="topbar__brand" href="/arbs/">
      <img :src="logo" alt="" width="28" height="28" />
      <span><strong>ARBS WebUI</strong><small>ARBS-H</small></span>
    </a>
    <nav class="topbar__links" :aria-label="t('top.switch_label')">
      <a href="/?ui=classic" data-feature="H-HOME-04" data-feature-2="H-V2NAV-06">{{ t('top.classic') }}</a>
      <a href="/v2/" data-feature="H-HOME-04">{{ t('top.v2') }}</a>
      <a href="/settings" data-feature="H-NAV-06">{{ t('top.full_settings') }}</a>
    </nav>
    <div class="topbar__tools">
      <div class="segmented" role="group" :aria-label="t('theme.label')" data-feature="H-NAV-11">
        <button
          v-for="value in themes"
          :key="value"
          type="button"
          class="segmented__item"
          :aria-pressed="ui.theme === value"
          :data-theme-choice="value"
          @click="ui.setTheme(value)"
        >
          {{ t(`theme.${value}`) }}
        </button>
      </div>
      <div class="segmented" role="group" :aria-label="t('top.language')">
        <button type="button" class="segmented__item" :aria-pressed="locale === 'ko'" @click="setLang('ko')">한국어</button>
        <button type="button" class="segmented__item" :aria-pressed="locale === 'en'" @click="setLang('en')">EN</button>
      </div>
    </div>
  </header>
</template>
