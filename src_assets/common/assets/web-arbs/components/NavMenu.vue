<script setup lang="ts">
// ARBS-H UI1b: menu groups (H-V2NAV-01). No "Browser stream" (H-V2STR-* are out of scope, P1).
// ARBS-H 0.2.1 (H021): group titles are headings (not links, no hover), items are an indented list.
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { isCurrent, NAV_GROUPS } from '@/logic/nav';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const ui = useUiStore();
</script>

<template>
  <nav id="arbs-nav" class="nav" :aria-label="t('nav.label')" data-feature="H-V2NAV-01">
    <div
      v-for="group in NAV_GROUPS"
      :key="group.id"
      class="nav__group"
      role="group"
      :aria-labelledby="`nav-group-${group.id}`"
    >
      <h2 :id="`nav-group-${group.id}`" class="nav__label" data-nav-heading>{{ t(group.label) }}</h2>
      <ul class="nav__items">
        <li v-for="item in group.items" :key="item.to">
          <RouterLink
            :to="item.to"
            class="nav__link"
            :class="{ 'nav__link--current': isCurrent(route.path, item.to) }"
            :aria-current="isCurrent(route.path, item.to) ? 'page' : undefined"
            :data-feature="item.feature || undefined"
            data-nav-item
            @click="ui.navOpen = false"
          >
            {{ t(item.label) }}
          </RouterLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
