<script setup lang="ts">
// ARBS-H UI1b: save bar (H-NAV-10, H-SET-208, H-SET-209, H-V2SET-01).
// One explicit save for every card: search settings, reload, discard, save, restart needed.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { SettingKey } from '@/logic/config';
import { unchangedReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';

const { t } = useI18n();
const settings = useSettingsStore();
const host = useHostStore();
const query = ref('');

const entries: { key: SettingKey; label: string; to: string }[] = [
  { key: 'controller', label: 'controller.input', to: '/controller' },
  { key: 'forward_rumble', label: 'controller.rumble', to: '/controller' },
  { key: 'gamepad', label: 'controller.gamepad', to: '/controller' },
  { key: 'dualsense_haptics_gain', label: 'controller.gain', to: '/controller' },
  { key: 'arbs_trigger_status', label: 'controller.trigger', to: '/controller' },
  { key: 'arbs_enet_precise_time', label: 'controller.precise', to: '/controller' },
  { key: 'virtual_display_mode', label: 'display.mode', to: '/display' },
  { key: 'dd_resolution_option', label: 'display.resolution', to: '/display' },
  { key: 'arbs_webui_default', label: 'account.default_ui', to: '/account' },
  { key: 'session_history_enabled', label: 'stats.history_enabled', to: '/stats' },
  { key: 'session_history_ttl_days', label: 'stats.history_ttl', to: '/stats' },
];

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return entries.filter((e) => t(e.label).toLowerCase().includes(q) || e.key.includes(q));
});

const saveReason = computed(() => unchangedReason(settings.changed.length));
const offline = computed(() => !host.online);

onMounted(() => {
  if (!settings.loaded) void settings.load();
});
</script>

<template>
  <section class="savebar" :aria-label="t('save.label')" data-feature="H-SET-209" data-feature-2="H-V2SET-01">
    <div class="savebar__search">
      <label class="sr-only" for="arbs-setting-search">{{ t('save.search') }}</label>
      <input
        id="arbs-setting-search"
        v-model="query"
        type="search"
        class="input"
        :placeholder="t('save.search')"
        autocomplete="off"
      />
      <ul v-if="results.length" class="savebar__results">
        <li v-for="item in results" :key="item.key">
          <RouterLink :to="item.to" @click="query = ''">{{ t(item.label) }}</RouterLink>
        </li>
      </ul>
      <p v-else-if="query.trim()" class="savebar__results muted">{{ t('save.no_result') }}</p>
    </div>
    <div class="savebar__status">
      <p class="savebar__state" role="status" data-feature="H-NAV-10" :data-state="settings.state">
        <template v-if="settings.state === 'saving'">{{ t('save.state_saving') }}</template>
        <template v-else-if="settings.state === 'error'">{{ t('save.failed') }}</template>
        <template v-else-if="settings.dirty">{{ t('save.unsaved', { count: settings.changed.length }) }}</template>
        <template v-else-if="settings.state === 'restart' || settings.restartPending">{{ t('save.state_restart') }}</template>
        <template v-else-if="settings.state === 'deferred'">{{ t('save.state_deferred') }}</template>
        <template v-else-if="settings.state === 'saved'">{{ t('save.state_saved') }}</template>
        <template v-else>{{ t('save.state_idle') }}</template>
      </p>
      <p class="savebar__hint muted" data-feature="H-SET-208">{{ t('save.hint') }}</p>
    </div>
    <div class="savebar__actions">
      <button class="button button--ghost" type="button" :disabled="settings.loading || offline" @click="settings.load()">
        {{ t('save.reload') }}
      </button>
      <button
        class="button button--ghost"
        type="button"
        :disabled="!!saveReason"
        :aria-disabled="!!saveReason"
        :aria-describedby="saveReason ? 'reason-save' : undefined"
        @click="settings.discard()"
      >
        {{ t('save.discard') }}
      </button>
      <button
        class="button button--primary"
        type="button"
        :disabled="!!saveReason || offline || settings.state === 'saving'"
        :aria-disabled="!!saveReason"
        :aria-describedby="saveReason ? 'reason-save' : undefined"
        data-save
        @click="settings.save()"
      >
        {{ t('save.save') }}
      </button>
      <button
        v-if="settings.restartPending"
        class="button button--primary"
        type="button"
        :disabled="offline"
        data-restart
        @click="host.restart()"
      >
        {{ t('common.restart') }}
      </button>
    </div>
    <p v-if="saveReason" id="reason-save" class="reason savebar__reason">{{ t(saveReason) }}</p>
  </section>
</template>
