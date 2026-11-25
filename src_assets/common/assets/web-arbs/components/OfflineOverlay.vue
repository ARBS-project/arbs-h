<script setup lang="ts">
// ARBS-H UI1b: connection lost cover (H-NAV-13, R2). The heartbeat (GET /api/configLocale)
// removes it when ARBS-H answers again (also after "ARBS-H 다시 시작").
import { useI18n } from 'vue-i18n';

import { useHostStore } from '@/stores/host';

const { t } = useI18n();
const host = useHostStore();
</script>

<template>
  <div class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="offline-title" data-feature="H-NAV-13">
    <div class="overlay__panel card">
      <h2 id="offline-title" class="card__title">
        {{ host.restarting ? t('offline.restarting') : t('offline.title') }}
      </h2>
      <p class="muted">{{ t('offline.help') }}</p>
      <button class="button button--primary" type="button" @click="host.beat()">{{ t('offline.retry') }}</button>
    </div>
  </div>
</template>
