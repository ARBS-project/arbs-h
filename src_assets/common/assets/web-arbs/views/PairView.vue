<script setup lang="ts">
// ARBS-H UI1b card D "기기 연결" > 새 기기: H-CLI-03, H-V2PAIR-01/03/04 (POST /api/pin).
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import { cleanPin, normalizedPin } from '@/logic/clients';
import { firstReason, offlineReason, pairReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';

const { t } = useI18n();
const host = useHostStore();
const name = ref('');
const pin = ref('');
const busy = ref(false);
const result = ref<'' | 'paired' | 'failed'>('');
const pairedName = ref('');

const reason = computed(() => firstReason(offlineReason(host.online), pairReason(name.value, pin.value)));

function onPin(event: Event): void {
  const input = event.target as HTMLInputElement;
  pin.value = cleanPin(input.value);
  input.value = pin.value;
}

async function approve(): Promise<void> {
  if (reason.value) return;
  busy.value = true;
  result.value = '';
  try {
    const response = await apiPost<{ status?: boolean }>('/api/pin', { pin: normalizedPin(pin.value), name: name.value.trim() });
    if (response?.status !== true) throw new Error('rejected');
    pairedName.value = name.value.trim();
    result.value = 'paired';
    pin.value = '';
  } catch {
    result.value = 'failed';
  } finally {
    busy.value = false;
  }
}

function another(): void {
  name.value = '';
  pin.value = '';
  result.value = '';
}
</script>

<template>
  <div class="page" data-feature="H-V2PAIR-01">
    <header class="page__head">
      <h1>{{ t('pair.title') }}</h1>
      <p class="muted">{{ t('pair.lead') }}</p>
      <RouterLink class="button button--ghost" to="/devices">{{ t('pair.back') }}</RouterLink>
    </header>

    <section class="card card--narrow" data-card="D" data-feature="H-CLI-03" data-feature-2="H-V2PAIR-03">
      <h2 class="card__title">{{ t('pair.form') }}</h2>
      <ol class="steps muted">
        <li>{{ t('pair.step1') }}</li>
        <li>{{ t('pair.step2') }}</li>
      </ol>
      <label class="field">
        <span>{{ t('pair.name') }}</span>
        <input v-model="name" class="input" maxlength="64" autocomplete="off" />
      </label>
      <label class="field">
        <span>{{ t('pair.pin') }}</span>
        <input
          :value="pin"
          class="input input--pin"
          inputmode="numeric"
          maxlength="4"
          autocomplete="one-time-code"
          @input="onPin"
        />
        <small class="muted">{{ t('pair.pin_help') }}</small>
      </label>
      <button
        class="button button--primary"
        type="button"
        :disabled="busy || !!reason"
        :aria-disabled="!!reason"
        :aria-describedby="reason ? 'reason-pair' : undefined"
        data-action="pair"
        @click="approve()"
      >
        {{ t('pair.approve') }}
      </button>
      <ReasonText id="reason-pair" :reason="reason" />

      <div v-if="result" class="banner" :class="result === 'paired' ? 'banner--ok' : 'banner--error'" role="status" data-feature="H-V2PAIR-04">
        <p>
          <strong>{{ result === 'paired' ? t('pair.paired', { name: pairedName }) : t('pair.failed') }}</strong>
        </p>
        <div class="row">
          <RouterLink class="button button--ghost" to="/devices">{{ t('pair.view_devices') }}</RouterLink>
          <button class="button button--ghost" type="button" @click="another()">{{ t('pair.another') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>
