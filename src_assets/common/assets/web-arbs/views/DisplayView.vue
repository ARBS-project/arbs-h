<script setup lang="ts">
// ARBS-H UI1b card V "화면(디스플레이)": H-SET-002, H-SET-003, H-HOME-05, H-V2SET-04, H-V2MNT-05.
// D-UI-3 R9 (no snapshot) and R14 (Windows only).
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiDelete, apiGet, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import { RESOLUTION_OPTIONS, VIRTUAL_DISPLAY_MODES } from '@/logic/config';
import { firstReason, isWindows, offlineReason, snapshotReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const host = useHostStore();
const settings = useSettingsStore();
const ui = useUiStore();

const golden = ref<{ exists?: boolean; out_of_date?: boolean } | null>(null);
const busy = ref('');

const windows = computed(() => isWindows(host.metadata?.platform ?? 'windows'));
const driver = computed(() => host.metadata?.virtual_display_driver ?? null);
const offline = computed(() => offlineReason(host.online));
const snapReason = computed(() => firstReason(offline.value, snapshotReason(golden.value)));

async function loadGolden(): Promise<void> {
  if (!windows.value) return;
  try {
    golden.value = await apiGet('/api/display/golden_status');
  } catch {
    golden.value = null;
  }
}

async function run(kind: 'terminate' | 'reset' | 'capture' | 'delete'): Promise<void> {
  if (kind === 'delete' && !window.confirm(t('display.delete_confirm'))) return;
  busy.value = kind;
  try {
    let result: { status?: boolean } | null = null;
    if (kind === 'terminate') result = await apiPost('/api/display/terminate_virtual', {});
    if (kind === 'reset') result = await apiPost('/api/reset-display-device-persistence', {});
    if (kind === 'capture') result = await apiPost('/api/display/export_golden', {});
    if (kind === 'delete') result = await apiDelete('/api/display/golden', {});
    if (result && result.status === false) throw new Error('rejected');
    ui.say(t(`display.done_${kind}`));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
    await loadGolden();
    void host.refreshHost();
  }
}

onMounted(loadGolden);
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.display') }}</h1>
      <p class="muted">{{ t('display.lead') }}</p>
    </header>

    <section v-if="!windows" class="card card--muted" data-card="V">
      <p class="muted">{{ t('display.windows_only') }}</p>
    </section>

    <div v-else class="grid">
      <section class="card" data-card="V">
        <h2 class="card__title">{{ t('display.stream_display') }}</h2>
        <label class="field" data-feature="H-SET-002">
          <span>{{ t('display.mode') }}</span>
          <select
            class="input"
            :value="settings.draft.virtual_display_mode"
            data-setting="virtual_display_mode"
            @change="settings.set('virtual_display_mode', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in VIRTUAL_DISPLAY_MODES" :key="m" :value="m">{{ t(`display.mode_${m}`) }}</option>
          </select>
          <small class="muted">{{ t('display.mode_help') }}</small>
        </label>
        <label class="field" data-feature="H-SET-003">
          <span>{{ t('display.resolution') }}</span>
          <select
            class="input"
            :value="settings.draft.dd_resolution_option"
            data-setting="dd_resolution_option"
            @change="settings.set('dd_resolution_option', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="r in RESOLUTION_OPTIONS" :key="r" :value="r">{{ t(`display.resolution_${r}`) }}</option>
          </select>
          <small class="muted">{{ t('display.resolution_help') }}</small>
        </label>
      </section>

      <section class="card" data-card="V" data-feature="H-V2SET-04">
        <h2 class="card__title">{{ t('display.driver') }}</h2>
        <dl class="facts">
          <dt>{{ t('display.driver_status') }}</dt>
          <dd>{{ driver?.status || t('common.unknown') }}</dd>
          <dt>{{ t('display.driver_configured') }}</dt>
          <dd>{{ driver?.configured || t('common.unknown') }}</dd>
          <dt>{{ t('display.driver_active') }}</dt>
          <dd>{{ driver?.active || t('common.none') }}</dd>
        </dl>
        <button class="button button--ghost" type="button" :disabled="!!busy || !!offline" @click="run('reset')">
          {{ t('display.reset') }}
        </button>
        <small class="muted">{{ t('display.reset_help') }}</small>
      </section>

      <section class="card" data-card="V" data-feature="H-V2MNT-05">
        <h2 class="card__title">{{ t('display.recovery') }}</h2>
        <p class="muted">
          {{ golden?.exists ? t('display.snapshot_yes') : t('display.snapshot_no') }}
          <template v-if="golden?.out_of_date"> · {{ t('display.snapshot_old') }}</template>
        </p>
        <div class="row">
          <button
            v-if="!golden?.exists"
            class="button button--primary"
            type="button"
            :disabled="!!busy || !!offline"
            data-action="snapshot-capture"
            @click="run('capture')"
          >
            {{ t('display.capture') }}
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="!!busy || !!snapReason"
            :aria-disabled="!!snapReason"
            :aria-describedby="snapReason ? 'reason-snapshot' : undefined"
            data-action="snapshot-replace"
            @click="run('capture')"
          >
            {{ t('display.replace') }}
          </button>
          <button
            class="button button--danger"
            type="button"
            :disabled="!!busy || !!snapReason"
            :aria-disabled="!!snapReason"
            :aria-describedby="snapReason ? 'reason-snapshot' : undefined"
            data-action="snapshot-delete"
            @click="run('delete')"
          >
            {{ t('display.delete') }}
          </button>
        </div>
        <ReasonText id="reason-snapshot" :reason="snapReason" />
        <div class="divider"></div>
        <div data-feature="H-HOME-05">
          <p class="muted">{{ t('display.terminate_help') }}</p>
          <button class="button button--danger" type="button" :disabled="!!busy || !!offline" @click="run('terminate')">
            {{ t('display.terminate') }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
