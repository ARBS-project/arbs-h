<script setup lang="ts">
// ARBS-H UI1b card D "기기 연결": H-NAV-03, H-CLI-06, H-CLI-08, H-V2DEV-03, H-V2DEV-04
// (pairing is PairView). D-UI-3 R3/R4: actions stay disabled until a device is chosen.
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { apiGet, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import {
  deviceStatus,
  hasPermission,
  normalizeDevice,
  PERMISSIONS,
  togglePermission,
  updatePayload,
  type PairedDevice,
} from '@/logic/clients';
import { deviceSelectReason, disconnectReason, firstReason, offlineReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const host = useHostStore();
const ui = useUiStore();

const devices = ref<PairedDevice[]>([]);
const loading = ref(false);
const busy = ref(false);
const edit = ref({ name: '', perm: 0, allow_sleep: false });

const selectedUuid = computed(() => (typeof route.params.uuid === 'string' ? route.params.uuid : ''));
const selected = computed(() => devices.value.find((d) => d.uuid === selectedUuid.value) ?? null);
const selectReason = computed(() => firstReason(offlineReason(host.online), deviceSelectReason(selected.value)));
const dropReason = computed(() => firstReason(offlineReason(host.online), disconnectReason(selected.value)));
const editChanged = computed(
  () =>
    !!selected.value &&
    (edit.value.name.trim() !== selected.value.name ||
      edit.value.perm !== selected.value.perm ||
      edit.value.allow_sleep !== selected.value.allow_sleep),
);
const saveReason = computed(() =>
  firstReason(
    selectReason.value,
    selected.value && !edit.value.name.trim() ? 'reason.need_device_name' : null,
    selected.value && !editChanged.value ? 'reason.no_changes' : null,
  ),
);

function resetEdit(): void {
  const d = selected.value;
  edit.value = d ? { name: d.name, perm: d.perm, allow_sleep: d.allow_sleep } : { name: '', perm: 0, allow_sleep: false };
}

async function loadDevices(): Promise<void> {
  loading.value = true;
  try {
    const list = await apiGet<{ named_certs?: unknown[] }>('/api/clients/list');
    devices.value = (list?.named_certs ?? []).map((item, i) => normalizeDevice(item, i));
  } catch {
    ui.say(t('devices.load_failed'), 'error');
  } finally {
    loading.value = false;
    resetEdit();
  }
}

function setPerm(bit: number, on: boolean): void {
  edit.value = { ...edit.value, perm: togglePermission(edit.value.perm, bit, on) };
}

async function saveDevice(): Promise<void> {
  if (!selected.value || saveReason.value) return;
  busy.value = true;
  try {
    // Re-read so the fields this card does not edit are sent back unchanged.
    const list = await apiGet<{ named_certs?: unknown[] }>('/api/clients/list');
    const latest = (list?.named_certs ?? []).map((item, i) => normalizeDevice(item, i)).find((d) => d.uuid === selected.value?.uuid);
    if (!latest) throw new Error('gone');
    const result = await apiPost<{ status?: boolean }>('/api/clients/update', updatePayload(latest, edit.value));
    if (result?.status !== true) throw new Error('rejected');
    ui.say(t('devices.saved'));
  } catch {
    ui.say(t('devices.save_failed'), 'error');
  } finally {
    busy.value = false;
    await loadDevices();
  }
}

async function act(kind: 'disconnect' | 'unpair'): Promise<void> {
  const d = selected.value;
  if (!d) return;
  if (kind === 'unpair' && !window.confirm(t('devices.unpair_confirm', { name: d.name || d.uuid }))) return;
  busy.value = true;
  try {
    const result = await apiPost<{ status?: boolean }>(`/api/clients/${kind}`, { uuid: d.uuid });
    if (result?.status !== true) throw new Error('rejected');
    ui.say(t(kind === 'unpair' ? 'devices.unpaired' : 'devices.disconnected', { name: d.name || d.uuid }));
    if (kind === 'unpair') await router.replace('/devices');
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = false;
    await loadDevices();
  }
}

watch(selectedUuid, resetEdit);
onMounted(loadDevices);
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.devices') }}</h1>
      <p class="muted">{{ t('devices.lead') }}</p>
      <RouterLink class="button button--primary" to="/devices/pair">{{ t('devices.pair') }}</RouterLink>
    </header>

    <div class="grid">
      <section class="card" data-card="D" data-feature="H-CLI-06" data-feature-2="H-V2DEV-03">
        <h2 class="card__title">{{ t('devices.list', { count: devices.length }) }}</h2>
        <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
        <p v-else-if="!devices.length" class="muted">{{ t('devices.empty') }}</p>
        <ul v-else class="list">
          <li
            v-for="d in devices"
            :key="d.uuid"
            class="list__row"
            :class="{ 'list__row--selected': d.uuid === selectedUuid }"
          >
            <span>
              <strong>{{ d.name || t('common.unknown') }}</strong>
              <span class="badge" :data-status="deviceStatus(d)">{{ t(`devices.status_${deviceStatus(d)}`) }}</span>
              <small class="muted">{{ d.connected ? t('devices.connected') : t('devices.offline') }}</small>
            </span>
            <RouterLink class="button button--ghost" :to="`/devices/${encodeURIComponent(d.uuid)}`" :data-device="d.uuid">
              {{ t('devices.edit') }}
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card" data-card="D" data-feature="H-V2DEV-04" aria-labelledby="device-panel-title">
        <h2 id="device-panel-title" class="card__title">
          {{ selected ? t('devices.selected', { name: selected.name || selected.uuid }) : t('devices.none_selected') }}
        </h2>
        <ReasonText id="reason-device" :reason="selectReason" />

        <label class="field">
          <span>{{ t('devices.name') }}</span>
          <input
            v-model="edit.name"
            class="input"
            :disabled="!!selectReason"
            :aria-describedby="selectReason ? 'reason-device' : undefined"
          />
        </label>
        <label class="check">
          <input
            v-model="edit.allow_sleep"
            type="checkbox"
            :disabled="!!selectReason"
            :aria-describedby="selectReason ? 'reason-device' : undefined"
          />
          <span>{{ t('devices.allow_sleep') }}</span>
        </label>

        <fieldset class="fieldset" :disabled="!!selectReason" data-feature="H-CLI-08">
          <legend>{{ t('devices.permissions') }}</legend>
          <label v-for="p in PERMISSIONS" :key="p.key" class="check">
            <input
              type="checkbox"
              :checked="hasPermission(edit.perm, p.bit)"
              :aria-describedby="selectReason ? 'reason-device' : undefined"
              @change="setPerm(p.bit, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t(`perm.${p.key}`) }}</span>
          </label>
        </fieldset>

        <div class="row">
          <button
            class="button button--primary"
            type="button"
            :disabled="busy || !!saveReason"
            :aria-disabled="!!saveReason"
            :aria-describedby="saveReason ? 'reason-device-save' : undefined"
            data-action="device-save"
            @click="saveDevice()"
          >
            {{ t('devices.save') }}
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="busy || !!dropReason"
            :aria-disabled="!!dropReason"
            :aria-describedby="dropReason ? 'reason-device-drop' : undefined"
            data-action="device-disconnect"
            @click="act('disconnect')"
          >
            {{ t('devices.disconnect') }}
          </button>
          <button
            class="button button--danger"
            type="button"
            :disabled="busy || !!selectReason"
            :aria-disabled="!!selectReason"
            :aria-describedby="selectReason ? 'reason-device' : undefined"
            data-action="device-unpair"
            @click="act('unpair')"
          >
            {{ t('devices.unpair') }}
          </button>
        </div>
        <ReasonText v-if="!selectReason" id="reason-device-save" :reason="saveReason" />
        <ReasonText v-if="!selectReason" id="reason-device-drop" :reason="dropReason" />
      </section>
    </div>
  </div>
</template>
