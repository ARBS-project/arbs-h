<script setup lang="ts">
// ARBS-H UI1b card A "앱": H-NAV-02, H-APP-01/02/05/08/09/10/22, H-V2LIB-03, H-V2APP-01/03/11.
// D-UI-3 R5 (no app chosen), R6 (per-app HD haptics needs gamepad input on), R8, R12.
// H021: "기본 앱" badge + two-line description for the 4 install default apps, "not ARBS" note on
// Remote Input/Monitor, restore buttons only for the default apps that are missing now.
// Per-app HD haptics is not tied to the gamepad type: it makes a DualSense for that app (H021 §4-2).
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { apiDelete, apiGet, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import {
  appBadge,
  appsFrom,
  defaultAppKind,
  NOT_ARBS_APPS,
  restorableSystemApps,
  appUuid,
  editFrom,
  isManaged,
  moveOrder,
  savePayload,
  SYSTEM_APPS,
  visibleCount,
  type AppEdit,
  type AppRecord,
} from '@/logic/apps';
import { appHapticsReason, appNameReason, appSelectReason, firstReason, offlineReason, runningReason } from '@/logic/rules';
import { searchCovers, uploadCover, type CoverCandidate } from '@/services/covers';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const host = useHostStore();
const settings = useSettingsStore();
const ui = useUiStore();

const apps = ref<AppRecord[]>([]);
const restorable = ref(restorableSystemApps(null));
const loading = ref(false);
const busy = ref('');
const pages = ref(1);
const edit = ref<AppEdit>(editFrom(null));
const covers = ref<CoverCandidate[]>([]);
const coverState = ref<'' | 'searching' | 'none' | 'failed'>('');

const isNew = computed(() => route.name === 'app-new');
const selectedUuid = computed(() => (typeof route.params.uuid === 'string' ? route.params.uuid : ''));
const selected = computed(() => apps.value.find((a) => appUuid(a) === selectedUuid.value) ?? null);
const editing = computed(() => isNew.value || !!selected.value);
const shown = computed(() => apps.value.slice(0, visibleCount(apps.value.length, pages.value)));

const offline = computed(() => offlineReason(host.online));
const pickReason = computed(() => firstReason(offline.value, appSelectReason(editing.value)));
const actionReason = computed(() => firstReason(offline.value, appSelectReason(!!selected.value)));
const closeReason = computed(() => firstReason(actionReason.value, runningReason(host.session)));
const hapticsReason = computed(() => firstReason(pickReason.value, appHapticsReason(settings.original)));
const saveReason = computed(() => firstReason(pickReason.value, appNameReason(edit.value.name)));

function resetEdit(): void {
  edit.value = editFrom(isNew.value ? null : selected.value);
  covers.value = [];
  coverState.value = '';
}

async function loadApps(): Promise<void> {
  loading.value = true;
  try {
    const payload = await apiGet<unknown>('/api/apps');
    apps.value = appsFrom(payload);
    restorable.value = restorableSystemApps(payload);
  } catch {
    ui.say(t('apps.load_failed'), 'error');
  } finally {
    loading.value = false;
    resetEdit();
  }
}

async function saveApp(): Promise<void> {
  if (saveReason.value) return;
  busy.value = 'save';
  try {
    let base: AppRecord | null = null;
    if (!isNew.value) {
      // Merge into the latest record so changes made elsewhere are kept (the server matches by uuid).
      const latest = appsFrom(await apiGet<unknown>('/api/apps'));
      base = latest.find((a) => appUuid(a) === selectedUuid.value) ?? null;
      if (!base) throw new Error('gone');
    }
    const result = await apiPost<{ status?: boolean }>('/api/apps', savePayload(base, edit.value));
    if (result?.status === false) throw new Error('rejected');
    ui.say(t('apps.saved', { name: edit.value.name.trim() }));
    await loadApps();
    if (isNew.value) {
      const created = apps.value.find((a) => a.name === edit.value.name.trim());
      await router.replace(created ? `/apps/${encodeURIComponent(appUuid(created))}` : '/apps');
    }
  } catch {
    ui.say(t('apps.save_failed'), 'error');
  } finally {
    busy.value = '';
  }
}

async function removeApp(): Promise<void> {
  const app = selected.value;
  if (!app || !window.confirm(t('apps.delete_confirm', { name: app.name || '' }))) return;
  busy.value = 'delete';
  try {
    await apiDelete(`/api/apps/${encodeURIComponent(appUuid(app))}`);
    ui.say(t('apps.deleted'));
    await router.replace('/apps');
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
    await loadApps();
  }
}

async function launch(): Promise<void> {
  if (!selected.value) return;
  busy.value = 'launch';
  try {
    await apiPost('/api/apps/launch', { uuid: appUuid(selected.value) });
    ui.say(t('apps.launched'));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
    void host.refreshHost();
  }
}

async function closeApp(): Promise<void> {
  busy.value = 'close';
  try {
    await apiPost('/api/apps/close', {});
    ui.say(t('apps.closed'));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
    void host.refreshHost();
  }
}

async function move(app: AppRecord, direction: -1 | 1): Promise<void> {
  const order = moveOrder(apps.value.map(appUuid), appUuid(app), direction);
  busy.value = 'order';
  try {
    await apiPost('/api/apps/reorder', { order });
    await loadApps();
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
  }
}

async function restoreSystem(id: (typeof SYSTEM_APPS)[number]): Promise<void> {
  busy.value = `restore-${id}`;
  try {
    await apiPost(`/api/apps/system/${id}/restore`, {});
    ui.say(t('apps.restored'));
    await loadApps();
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
  }
}

async function findCovers(): Promise<void> {
  coverState.value = 'searching';
  try {
    covers.value = await searchCovers(edit.value.name);
    coverState.value = covers.value.length ? '' : 'none';
  } catch {
    coverState.value = 'failed';
  }
}

async function pickCover(cover: CoverCandidate): Promise<void> {
  busy.value = 'cover';
  try {
    edit.value = { ...edit.value, imagePath: await uploadCover(cover) };
    covers.value = [];
  } catch {
    ui.say(t('apps.cover_failed'), 'error');
  } finally {
    busy.value = '';
  }
}

watch(() => route.fullPath, resetEdit);
onMounted(async () => {
  if (!settings.loaded) void settings.load();
  await loadApps();
});
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.apps') }}</h1>
      <p class="muted">{{ t('apps.lead') }}</p>
      <RouterLink class="button button--primary" to="/apps/new" data-feature="H-APP-02" data-feature-2="H-V2APP-01">
        {{ t('apps.add') }}
      </RouterLink>
    </header>

    <div class="grid">
      <section class="card" data-card="A" data-feature="H-APP-01">
        <h2 class="card__title">{{ t('apps.count', { count: apps.length }) }}</h2>
        <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
        <ul class="list" data-feature="H-APP-05">
          <li
            v-for="(app, i) in shown"
            :key="appUuid(app) || i"
            class="list__row"
            :class="{ 'list__row--selected': appUuid(app) === selectedUuid }"
          >
            <img class="thumb" :src="`/api/apps/${encodeURIComponent(appUuid(app))}/cover`" alt="" loading="lazy" />
            <span class="list__grow">
              <strong>{{ app.name || t('common.unknown') }}</strong>
              <span class="badge" :data-badge="appBadge(app)">{{ t(`apps.badge_${appBadge(app)}`) }}</span>
              <span v-if="isManaged(app)" class="badge">{{ t('apps.badge_managed') }}</span>
              <template v-if="defaultAppKind(app)">
                <small class="app-about" :data-app-about="defaultAppKind(app)">
                  <span>{{ t(`apps.about_${defaultAppKind(app)}_what`) }}</span>
                  <span>{{ t(`apps.about_${defaultAppKind(app)}_when`) }}</span>
                  <span v-if="NOT_ARBS_APPS.includes(defaultAppKind(app)!)" class="app-about__note" data-not-arbs>
                    {{ t('apps.not_arbs') }}
                  </span>
                </small>
              </template>
            </span>
            <span class="row row--tight">
              <button class="button button--icon" type="button" :aria-label="t('apps.up')" :disabled="i === 0 || !!busy" @click="move(app, -1)">↑</button>
              <button
                class="button button--icon"
                type="button"
                :aria-label="t('apps.down')"
                :disabled="i === apps.length - 1 || !!busy"
                @click="move(app, 1)"
              >
                ↓
              </button>
              <RouterLink class="button button--ghost" :to="`/apps/${encodeURIComponent(appUuid(app))}`" :data-app="appUuid(app)">
                {{ t('apps.pick') }}
              </RouterLink>
            </span>
          </li>
        </ul>
        <div class="row" data-feature="H-V2LIB-03">
          <span class="muted">{{ t('apps.showing', { visible: shown.length, total: apps.length }) }}</span>
          <button v-if="shown.length < apps.length" class="button button--ghost" type="button" @click="pages++">
            {{ t('apps.more') }}
          </button>
        </div>
        <details class="details">
          <summary>{{ t('apps.system_title') }}</summary>
          <p class="muted">{{ t('apps.system_help') }}</p>
          <div class="row">
            <button
              v-for="id in SYSTEM_APPS"
              :key="id"
              class="button button--ghost"
              type="button"
              :disabled="!!busy || !!offline || !restorable.has(id)"
              :data-restore="id"
              @click="restoreSystem(id)"
            >
              {{ t(`apps.system_${id}`) }}
            </button>
          </div>
          <p class="muted">{{ t('apps.system_present') }}</p>
          <p class="muted" data-steam-bp-note>{{ t('apps.system_steam_bp') }}</p>
        </details>
      </section>

      <section class="card" data-card="A" aria-labelledby="app-panel-title">
        <h2 id="app-panel-title" class="card__title">
          {{ isNew ? t('apps.new_title') : selected ? t('apps.selected', { name: selected.name || '' }) : t('apps.none_selected') }}
        </h2>
        <ReasonText id="reason-app" :reason="pickReason" />

        <div class="row" data-feature="H-APP-08">
          <button
            class="button button--ghost"
            type="button"
            :disabled="!!busy || !!actionReason"
            :aria-disabled="!!actionReason"
            :aria-describedby="actionReason ? 'reason-app' : undefined"
            data-action="app-launch"
            @click="launch()"
          >
            {{ t('apps.launch') }}
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="!!busy || !!closeReason"
            :aria-disabled="!!closeReason"
            :aria-describedby="closeReason ? 'reason-app-close' : undefined"
            data-action="app-close"
            @click="closeApp()"
          >
            {{ t('apps.close') }}
          </button>
          <button
            class="button button--danger"
            type="button"
            :disabled="!!busy || !!actionReason"
            :aria-disabled="!!actionReason"
            :aria-describedby="actionReason ? 'reason-app' : undefined"
            data-action="app-delete"
            @click="removeApp()"
          >
            {{ t('apps.delete') }}
          </button>
        </div>
        <ReasonText v-if="!actionReason" id="reason-app-close" :reason="closeReason" />

        <fieldset class="fieldset" :disabled="!!pickReason" data-feature="H-V2APP-03">
          <legend>{{ t('apps.edit') }}</legend>
          <label class="field" data-feature="H-APP-09">
            <span>{{ t('apps.name') }}</span>
            <input v-model="edit.name" class="input" :aria-describedby="pickReason ? 'reason-app' : undefined" data-field="app-name" />
          </label>
          <label class="field" data-feature="H-APP-10">
            <span>{{ t('apps.cmd') }}</span>
            <input v-model="edit.cmd" class="input" :aria-describedby="pickReason ? 'reason-app' : undefined" />
            <small class="muted">{{ t('apps.cmd_help') }}</small>
          </label>
          <label class="field">
            <span>{{ t('apps.cover') }}</span>
            <input v-model="edit.imagePath" class="input" />
          </label>
          <div class="row">
            <button class="button button--ghost" type="button" :disabled="!edit.name.trim() || coverState === 'searching'" @click="findCovers()">
              {{ t('apps.cover_find') }}
            </button>
            <span v-if="coverState" class="muted">{{ t(`apps.cover_${coverState}`) }}</span>
          </div>
          <ul v-if="covers.length" class="covers">
            <li v-for="c in covers.slice(0, 8)" :key="c.key">
              <button class="cover" type="button" :disabled="busy === 'cover'" @click="pickCover(c)">
                <img :src="c.url" :alt="c.name" loading="lazy" />
                <small>{{ c.name }}</small>
              </button>
            </li>
          </ul>
          <label class="check">
            <input v-model="edit.elevated" type="checkbox" />
            <span>{{ t('apps.elevated') }}</span>
          </label>
        </fieldset>

        <label class="check" data-feature="H-APP-22" data-feature-2="H-V2APP-11">
          <input
            v-model="edit.dualsenseHaptics"
            type="checkbox"
            :disabled="!!hapticsReason"
            :aria-describedby="pickReason ? 'reason-app' : hapticsReason ? 'reason-app-haptics' : 'help-app-haptics'"
            data-field="app-haptics"
          />
          <span>
            <strong>{{ t('apps.haptics') }}</strong>
            <small id="help-app-haptics" class="muted">{{ t('apps.haptics_help') }}</small>
          </span>
        </label>
        <ReasonText v-if="!pickReason" id="reason-app-haptics" :reason="hapticsReason" />

        <div class="row">
          <button
            class="button button--primary"
            type="button"
            :disabled="!!busy || !!saveReason"
            :aria-disabled="!!saveReason"
            :aria-describedby="saveReason ? 'reason-app-save' : undefined"
            data-action="app-save"
            @click="saveApp()"
          >
            {{ t('apps.save') }}
          </button>
          <RouterLink class="button button--ghost" to="/apps">{{ t('apps.back') }}</RouterLink>
        </div>
        <ReasonText v-if="!pickReason" id="reason-app-save" :reason="saveReason" />
      </section>
    </div>
  </div>
</template>
