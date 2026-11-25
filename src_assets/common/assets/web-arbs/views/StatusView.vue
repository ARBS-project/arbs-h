<script setup lang="ts">
// ARBS-H UI1b card S "상태": H-NAV-01, H-HOME-07/08/09/11, H-STAT-05, H-V2NAV-04, H-V2NAV-09,
// H-V2OV-02/04/09, H-V2STAT-04, H-V2MNT-02.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiDelete, apiGet, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import { fatalLines } from '@/logic/logs';
import { runningReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import type { ChangelogEntry } from '@/utils/changelog';
import { ISSUES_NEW_PAGE, RELEASES_PAGE } from '@/utils/repo';
import { dismissedUpdate, dismissUpdate, fetchUpdateReleases, selectAvailableUpdate } from '@/utils/updates';

const { t } = useI18n();
const host = useHostStore();
const settings = useSettingsStore();
const ui = useUiStore();

interface RtspSession {
  uuid?: string;
  device_name?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
}
interface WebrtcSession {
  id?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
}

const rtsp = ref<RtspSession[]>([]);
const webrtc = ref<WebrtcSession[]>([]);
const fatal = ref<string[]>([]);
const load = ref<number | null>(null);
const update = ref<ChangelogEntry | null>(null);
const updateState = ref<'idle' | 'checking' | 'none' | 'found' | 'failed'>('idle');
const dismissed = ref(false);
const stopping = ref('');

const metadata = computed(() => host.metadata);
const version = computed(() => (typeof metadata.value?.version === 'string' ? metadata.value.version : ''));

const readiness = computed<'streaming' | 'attention' | 'ready' | 'unknown'>(() => {
  if (host.hostError) return 'attention';
  if (host.streaming) return 'streaming';
  if (!metadata.value) return 'unknown';
  if (metadata.value.encoder_status?.state === 'failed' || host.session?.lastEncoderProbeFailed) return 'attention';
  return metadata.value.encoder_status?.state === 'ready' ? 'ready' : 'attention';
});

const warnings = computed(() => {
  const list: string[] = [];
  if (host.session?.appRunning && (host.session.activeSessions ?? 0) === 0) list.push('status.warn_app_running');
  if (host.session?.lastEncoderProbeFailed || metadata.value?.encoder_status?.state === 'failed')
    list.push('status.warn_encoder');
  if (load.value !== null && load.value >= 95) list.push('status.warn_load');
  if (host.hostError || !metadata.value) list.push('status.warn_no_data');
  return list;
});

const stopReason = computed(() => runningReason(host.session));
const sessionCount = computed(() => rtsp.value.length + webrtc.value.length);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function loadSessions(): Promise<void> {
  const [r, w] = await Promise.allSettled([
    apiGet<{ sessions?: RtspSession[] }>('/api/rtsp/sessions'),
    apiGet<{ sessions?: WebrtcSession[] }>('/api/webrtc/sessions'),
  ]);
  rtsp.value = r.status === 'fulfilled' ? (r.value?.sessions ?? []) : [];
  webrtc.value = w.status === 'fulfilled' ? (w.value?.sessions ?? []) : [];
}

async function loadExtras(): Promise<void> {
  try {
    const stats = await apiGet<{ cpu_percent?: number; gpu_percent?: number }>('/api/host/stats');
    load.value = Math.max(stats?.cpu_percent ?? 0, stats?.gpu_percent ?? 0);
  } catch {
    load.value = null;
  }
  try {
    const text = await apiGet<string>('/api/logs?tail=2000');
    fatal.value = typeof text === 'string' ? fatalLines(text) : [];
  } catch {
    fatal.value = [];
  }
}

async function refresh(): Promise<void> {
  await host.refreshHost();
  await Promise.all([loadSessions(), loadExtras()]);
}

async function checkUpdates(): Promise<void> {
  if (!version.value) await host.refreshHost();
  updateState.value = 'checking';
  try {
    if (!settings.loaded) await settings.load();
    const notifyPre = settings.raw.notify_pre_releases;
    const platform = String(metadata.value?.platform ?? 'windows').toLowerCase().includes('windows')
      ? 'windows'
      : String(metadata.value?.platform ?? '');
    const arch = typeof metadata.value?.architecture === 'string' ? metadata.value.architecture : 'x86_64';
    const releases = await fetchUpdateReleases(AbortSignal.timeout(15000), platform, true, arch);
    update.value = selectAvailableUpdate(version.value, releases, notifyPre, platform, arch);
    updateState.value = update.value ? 'found' : 'none';
    dismissed.value = update.value ? dismissedUpdate(storage() ?? localStorageStub, update.value.tag) : false;
  } catch {
    updateState.value = 'failed';
  }
}

const localStorageStub = { getItem: () => null, setItem: () => undefined };

function hideUpdate(): void {
  if (!update.value) return;
  dismissUpdate(storage() ?? localStorageStub, update.value.tag);
  dismissed.value = true;
}

async function stopRtsp(): Promise<void> {
  stopping.value = 'rtsp';
  try {
    await apiPost('/api/apps/close', {});
    ui.say(t('status.stopped'));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    stopping.value = '';
    await refresh();
  }
}

async function stopWebrtc(id: string): Promise<void> {
  stopping.value = id;
  try {
    await apiDelete(`/api/webrtc/sessions/${encodeURIComponent(id)}`);
    ui.say(t('status.stopped'));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    stopping.value = '';
    await refresh();
  }
}

onMounted(() => {
  void refresh();
  void checkUpdates();
});
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.status') }}</h1>
      <p class="muted">{{ t('status.lead') }}</p>
    </header>

    <div class="grid">
      <section class="card" data-card="S" data-feature="H-V2OV-02">
        <h2 class="card__title">{{ t('status.host') }}</h2>
        <p class="state" :data-readiness="readiness">
          <span class="dot" aria-hidden="true"></span>
          <strong>{{ t(`status.readiness_${readiness}`) }}</strong>
        </p>
        <p class="muted">
          {{ t('status.updated') }}:
          {{ host.lastUpdated ? new Date(host.lastUpdated).toLocaleTimeString() : t('common.none') }}
        </p>
        <button
          class="button button--ghost"
          type="button"
          :aria-busy="host.loadingHost"
          data-feature="H-V2NAV-04"
          @click="refresh()"
        >
          {{ t('status.refresh') }}
        </button>
        <ul v-if="warnings.length" class="list list--warn" data-feature="H-V2OV-04">
          <li v-for="w in warnings" :key="w">{{ t(w) }}</li>
        </ul>
        <p v-else class="muted" data-feature-2="H-V2OV-04">{{ t('status.no_warning') }}</p>
      </section>

      <section class="card" data-card="S">
        <h2 class="card__title">{{ t('status.version_title') }}</h2>
        <p data-feature="H-HOME-07">
          {{ t('status.current_version') }}: <strong>{{ version || t('common.unknown') }}</strong>
        </p>
        <div data-feature="H-HOME-08" data-feature-2="H-V2NAV-09">
          <p v-if="updateState === 'checking'" class="muted">{{ t('status.update_checking') }}</p>
          <p v-else-if="updateState === 'none'" class="muted">{{ t('status.update_none') }}</p>
          <p v-else-if="updateState === 'failed'" class="error">{{ t('status.update_failed') }}</p>
          <div v-if="update && !dismissed" class="banner banner--accent" data-feature="H-HOME-09">
            <p>
              <strong>{{ t('status.update_found', { version: update.tag }) }}</strong>
            </p>
            <p class="muted">{{ t('status.update_help') }}</p>
            <div class="row">
              <a class="button button--primary" :href="update.url || RELEASES_PAGE" target="_blank" rel="noopener noreferrer">
                {{ t('status.update_open') }}
              </a>
              <button class="button button--ghost" type="button" @click="hideUpdate()">{{ t('status.update_hide') }}</button>
            </div>
          </div>
          <button class="button button--ghost" type="button" :disabled="updateState === 'checking'" @click="checkUpdates()">
            {{ t('status.update_check') }}
          </button>
        </div>
        <nav class="row" data-feature="H-V2OV-09">
          <a :href="ISSUES_NEW_PAGE" target="_blank" rel="noopener noreferrer">{{ t('status.report_bug') }}</a>
          <a :href="RELEASES_PAGE" target="_blank" rel="noopener noreferrer">{{ t('status.release_page') }}</a>
        </nav>
        <details class="details" data-feature="H-V2MNT-02">
          <summary>{{ t('status.version_info') }}</summary>
          <dl class="facts">
            <dt>{{ t('status.version') }}</dt>
            <dd>{{ metadata?.version || t('common.unknown') }}</dd>
            <dt>{{ t('status.platform') }}</dt>
            <dd>{{ metadata?.platform || t('common.unknown') }} {{ metadata?.architecture || '' }}</dd>
            <dt>{{ t('status.branch') }}</dt>
            <dd>{{ metadata?.branch || t('common.unknown') }}</dd>
            <dt>{{ t('status.commit') }}</dt>
            <dd><code>{{ metadata?.commit || t('common.unknown') }}</code></dd>
            <dt>{{ t('status.release_date') }}</dt>
            <dd>{{ metadata?.release_date || t('common.unknown') }}</dd>
          </dl>
          <a :href="update?.url || RELEASES_PAGE" target="_blank" rel="noopener noreferrer">{{ t('status.release_notes') }}</a>
        </details>
      </section>

      <section v-if="fatal.length" class="card card--error" data-card="S" data-feature="H-HOME-11">
        <h2 class="card__title">{{ t('status.fatal_title') }}</h2>
        <pre class="log log--short">{{ fatal.join('\n') }}</pre>
        <RouterLink class="button button--ghost" to="/troubleshoot">{{ t('status.fatal_open') }}</RouterLink>
      </section>

      <section class="card card--wide" data-card="S" data-feature="H-STAT-05" data-feature-2="H-V2STAT-04">
        <h2 class="card__title">{{ t('status.sessions', { count: sessionCount }) }}</h2>
        <p v-if="host.session?.appRunning" class="muted">
          {{ t('status.app_running', { name: host.session.appName || t('common.unknown') }) }}
        </p>
        <p v-if="!sessionCount" class="muted">{{ t('status.no_sessions') }}</p>
        <ul v-else class="list">
          <li v-for="s in rtsp" :key="s.uuid" class="list__row">
            <span>
              <strong>{{ s.device_name || 'Moonlight' }}</strong>
              <small class="muted"> {{ s.width }}×{{ s.height }} · {{ s.fps }} fps · {{ s.codec }}</small>
            </span>
            <button class="button button--danger" type="button" :disabled="stopping === 'rtsp'" @click="stopRtsp()">
              {{ t('status.stop_stream') }}
            </button>
          </li>
          <li v-for="s in webrtc" :key="s.id" class="list__row">
            <span>
              <strong>WebRTC</strong>
              <small class="muted"> {{ s.width }}×{{ s.height }} · {{ s.fps }} fps · {{ s.codec }}</small>
            </span>
            <button class="button button--danger" type="button" :disabled="stopping === s.id" @click="stopWebrtc(s.id || '')">
              {{ t('status.stop_stream') }}
            </button>
          </li>
        </ul>
        <button
          v-if="!sessionCount"
          class="button button--danger"
          type="button"
          :disabled="!!stopReason"
          :aria-disabled="!!stopReason"
          :aria-describedby="stopReason ? 'reason-stop' : undefined"
          @click="stopRtsp()"
        >
          {{ t('status.stop_stream') }}
        </button>
        <ReasonText id="reason-stop" :reason="sessionCount ? null : stopReason" />
      </section>
    </div>
  </div>
</template>
