<script setup lang="ts">
// ARBS-H UI1b: shell = fixed top bar + menu + card page + save bar + footer notice.
// Login / first account and the offline cover sit on top (R1, R2).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import FooterNotice from '@/components/FooterNotice.vue';
import LoginOverlay from '@/components/LoginOverlay.vue';
import NavMenu from '@/components/NavMenu.vue';
import OfflineOverlay from '@/components/OfflineOverlay.vue';
import SaveBar from '@/components/SaveBar.vue';
import TopBar from '@/components/TopBar.vue';
import { useHostStore } from '@/stores/host';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const host = useHostStore();
const ui = useUiStore();

const routeNotice = computed(() => {
  const notice = route.query.notice;
  return typeof notice === 'string' && notice ? `guard.${notice}` : '';
});
</script>

<template>
  <div class="shell" :class="{ 'shell--nav-open': ui.navOpen }">
    <TopBar />
    <div class="shell__body">
      <NavMenu />
      <main id="main" class="shell__main" tabindex="-1">
        <p v-if="routeNotice" class="banner banner--info" role="status" data-guard-notice>{{ t(routeNotice) }}</p>
        <p v-if="ui.notice" class="banner" :class="ui.noticeTone === 'error' ? 'banner--error' : 'banner--info'" role="status">
          {{ ui.notice }}
        </p>
        <RouterView v-if="host.signedIn" />
        <section v-else class="card card--muted" aria-live="polite">
          <h2 class="card__title">{{ t('auth.locked_title') }}</h2>
          <p class="muted">{{ t(host.needsSetup ? 'reason.need_account' : 'reason.need_login') }}</p>
        </section>
        <FooterNotice />
      </main>
    </div>
    <SaveBar v-if="host.signedIn" />
    <LoginOverlay v-if="host.authLoaded && !host.signedIn && host.online" />
    <OfflineOverlay v-if="!host.online" />
  </div>
</template>
