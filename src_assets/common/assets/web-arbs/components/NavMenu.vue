<script setup lang="ts">
// ARBS-H UI1b: menu groups (H-V2NAV-01). No "Browser stream" (H-V2STR-* are out of scope, P1).
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const ui = useUiStore();

const groups = [
  {
    label: 'nav.group_home',
    items: [{ to: '/', label: 'nav.status', feature: 'H-NAV-01' }],
  },
  {
    label: 'nav.group_connect',
    items: [
      { to: '/devices', label: 'nav.devices', feature: 'H-NAV-03' },
      { to: '/apps', label: 'nav.apps', feature: 'H-NAV-02' },
    ],
  },
  {
    label: 'nav.group_settings',
    items: [
      { to: '/controller', label: 'nav.controller', feature: '' },
      { to: '/display', label: 'nav.display', feature: '' },
    ],
  },
  {
    label: 'nav.group_manage',
    items: [
      { to: '/troubleshoot', label: 'nav.troubleshoot', feature: 'H-NAV-07' },
      { to: '/account', label: 'nav.account', feature: '' },
    ],
  },
];

function current(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`);
}
</script>

<template>
  <nav id="arbs-nav" class="nav" :aria-label="t('nav.label')" data-feature="H-V2NAV-01">
    <div v-for="group in groups" :key="group.label" class="nav__group">
      <p class="nav__label">{{ t(group.label) }}</p>
      <RouterLink
        v-for="item in group.items"
        :key="item.to"
        :to="item.to"
        class="nav__link"
        :class="{ 'nav__link--current': current(item.to) }"
        :aria-current="current(item.to) ? 'page' : undefined"
        :data-feature="item.feature || undefined"
        @click="ui.navOpen = false"
      >
        {{ t(item.label) }}
      </RouterLink>
    </div>
  </nav>
</template>
