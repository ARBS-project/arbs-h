<script setup lang="ts">
// ARBS-H 0.2.1 (H021) card M "통계" (관리 묶음): H-STAT-05/H-V2STAT-04 (지금 스트리밍),
// H-STAT-06/H-V2STAT-05 (최근 세션·자세히), H-STAT-03/H-V2STAT-02 (호스트 사용량 일부),
// H-STAT-02 (수집 꺼짐 안내만), H-SET-173/174 (기록 설정, 고급). Existing API only (logic/stats.ts).
// No charts, no export, no delete (those stay in the classic UI).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiGet } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import { clampDays, serverBool } from '@/logic/config';
import { historyToggleReason } from '@/logic/rules';
import {
  codecText,
  formatBitrate,
  fpsGrade,
  historyAvailable,
  hostUsage,
  jitterGrade,
  latencyGrade,
  lossGrade,
  lossPercent,
  pickLive,
  recentFrom,
  splitDuration,
  summarizeSamples,
  verdictGrade,
  type Grade,
  type HostUsage,
  type LiveSession,
  type RecentSession,
  type SampleSummary,
} from '@/logic/stats';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';

const { t, locale } = useI18n();
const host = useHostStore();
const settings = useSettingsStore();

const PAGE = 10;
const live = ref<LiveSession[]>([]);
const usage = ref<HostUsage | null>(null);
const recent = ref<RecentSession[]>([]);
const recentMore = ref(false);
const historyOk = ref(true);
const loadFailed = ref(false);
const detailUuid = ref('');
const detail = ref<SampleSummary | null>(null);
const detailState = ref<'' | 'loading' | 'failed'>('');
let timer: ReturnType<typeof setInterval> | null = null;

const hostStatsOff = computed(() => settings.loaded && !serverBool(settings.raw.realtime_stats_enabled, true));
// The server keeps the old value while a stream is active (config.cpp:3386-3388), so wait for the end.
const toggleReason = computed(() => historyToggleReason((host.session?.activeSessions ?? 0) > 0));
const detailSession = computed(() => recent.value.find((s) => s.uuid === detailUuid.value) ?? null);

interface Row {
  id: string;
  label: string;
  value: string;
  grade: Grade;
  help: string;
}

function duration(seconds: number | null): string {
  const d = splitDuration(seconds);
  if (!d) return '';
  if (d.h) return t('stats.duration_h', { h: d.h, m: d.m });
  if (d.m) return t('stats.duration_m', { m: d.m, s: d.s });
  return t('stats.duration_s', { s: d.s });
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? t('stats.no_value') : t('stats.percent', { value });
}

function size(w: number | null, h: number | null): string {
  return w && h ? `${w}×${h}` : '';
}

function liveRows(s: LiveSession): Row[] {
  const percent = lossPercent(s.losses, s.framesSent);
  const fps =
    s.actualFps !== null && s.targetFps !== null
      ? t('stats.fps_value', { actual: s.actualFps, target: s.targetFps })
      : s.targetFps !== null
        ? t('stats.fps_target_only', { target: s.targetFps })
        : '';
  const bitrate =
    s.bitrateKbps !== null && s.requestedKbps !== null
      ? t('stats.pair_value', { a: formatBitrate(s.bitrateKbps), b: formatBitrate(s.requestedKbps) })
      : formatBitrate(s.bitrateKbps ?? s.requestedKbps);
  const loss =
    s.losses === null
      ? ''
      : percent === null
        ? t('stats.loss_count', { count: s.losses })
        : percent === 0 && s.losses > 0
          ? t('stats.loss_value_small', { count: s.losses })
          : t('stats.loss_value', { count: s.losses, percent });
  return [
    { id: 'resolution', label: t('stats.m_resolution'), value: size(s.width, s.height), grade: 'info', help: t('stats.h_resolution') },
    { id: 'fps', label: t('stats.m_fps'), value: fps, grade: fpsGrade(s.actualFps, s.targetFps), help: t('stats.h_fps') },
    { id: 'codec', label: t('stats.m_codec'), value: codecText(s), grade: 'info', help: t('stats.h_codec') },
    { id: 'bitrate', label: t('stats.m_bitrate'), value: bitrate, grade: 'info', help: t('stats.h_bitrate') },
    { id: 'loss', label: t('stats.m_loss'), value: loss, grade: lossGrade(s.losses, s.framesSent), help: t('stats.h_loss') },
    {
      id: 'latency',
      label: t('stats.m_latency'),
      value: s.encodeLatencyMs === null ? '' : t('stats.ms', { value: s.encodeLatencyMs }),
      grade: latencyGrade(s.encodeLatencyMs),
      help: t('stats.h_latency'),
    },
    {
      id: 'jitter',
      label: t('stats.m_jitter'),
      value: s.jitterMs === null ? '' : t('stats.ms', { value: s.jitterMs }),
      grade: jitterGrade(s.jitterMs, s.actualFps ?? s.targetFps),
      help: t('stats.h_jitter'),
    },
    { id: 'idr', label: t('stats.m_idr'), value: s.idrRequests === null ? '' : String(s.idrRequests), grade: 'info', help: t('stats.h_idr') },
    { id: 'uptime', label: t('stats.m_uptime'), value: duration(s.uptimeSeconds), grade: 'info', help: t('stats.h_uptime') },
  ];
}

function detailRows(d: SampleSummary, s: RecentSession | null): Row[] {
  return [
    { id: 'samples', label: t('stats.d_samples'), value: String(d.count), grade: 'info', help: t('stats.h_samples') },
    {
      id: 'avg_fps',
      label: t('stats.d_avg_fps'),
      value: d.avgFps === null ? '' : s?.targetFps ? t('stats.fps_value', { actual: d.avgFps, target: s.targetFps }) : String(d.avgFps),
      grade: fpsGrade(d.avgFps, s?.targetFps ?? null),
      help: t('stats.h_fps'),
    },
    { id: 'avg_bitrate', label: t('stats.d_avg_bitrate'), value: formatBitrate(d.avgBitrateKbps), grade: 'info', help: t('stats.h_bitrate') },
    {
      id: 'latency',
      label: t('stats.d_latency'),
      value: d.avgLatencyMs === null || d.maxLatencyMs === null ? '' : t('stats.latency_value', { avg: d.avgLatencyMs, max: d.maxLatencyMs }),
      grade: latencyGrade(d.maxLatencyMs),
      help: t('stats.h_latency'),
    },
    {
      id: 'max_loss',
      label: t('stats.d_max_loss'),
      value: d.maxLossPercent === null ? '' : t('stats.percent', { value: d.maxLossPercent }),
      grade: d.maxLossPercent === null ? 'info' : d.maxLossPercent === 0 ? 'good' : d.maxLossPercent > 5 ? 'bad' : 'warn',
      help: t('stats.h_loss'),
    },
    { id: 'dropped', label: t('stats.d_dropped'), value: d.videoDropped === null ? '' : String(d.videoDropped), grade: 'info', help: t('stats.h_dropped') },
    {
      id: 'jitter',
      label: t('stats.d_jitter'),
      value: d.avgJitterMs === null ? '' : t('stats.ms', { value: d.avgJitterMs }),
      grade: jitterGrade(d.avgJitterMs, d.avgFps ?? s?.targetFps ?? null),
      help: t('stats.h_jitter'),
    },
  ];
}

function when(unix: number | null): string {
  if (unix === null) return '';
  try {
    return new Date(unix * 1000).toLocaleString(locale.value === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

async function loadLive(): Promise<void> {
  const [h, r, u] = await Promise.allSettled([
    apiGet<unknown>('/api/history/sessions/active'),
    apiGet<unknown>('/api/rtsp/sessions'),
    apiGet<unknown>('/api/host/stats'),
  ]);
  live.value = pickLive(h.status === 'fulfilled' ? h.value : null, r.status === 'fulfilled' ? r.value : null);
  usage.value = u.status === 'fulfilled' ? hostUsage(u.value) : null;
  loadFailed.value = h.status === 'rejected' && r.status === 'rejected';
}

async function loadRecent(append = false): Promise<void> {
  try {
    const offset = append ? recent.value.length : 0;
    const payload = await apiGet<unknown>(`/api/history/sessions?limit=${PAGE}&offset=${offset}`);
    const list = recentFrom(payload);
    historyOk.value = historyAvailable(payload);
    recent.value = append ? [...recent.value, ...list] : list;
    recentMore.value = list.length === PAGE;
  } catch {
    if (!append) recent.value = [];
    recentMore.value = false;
    historyOk.value = false;
  }
}

async function openDetail(uuid: string): Promise<void> {
  if (detailUuid.value === uuid) {
    detailUuid.value = '';
    return;
  }
  detailUuid.value = uuid;
  detail.value = null;
  detailState.value = 'loading';
  try {
    detail.value = summarizeSamples(await apiGet<unknown>(`/api/history/sessions/${encodeURIComponent(uuid)}`));
    detailState.value = '';
  } catch {
    detailState.value = 'failed';
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadLive(), loadRecent()]);
}

function setDays(event: Event): void {
  settings.set('session_history_ttl_days', clampDays((event.target as HTMLInputElement).value));
}

onMounted(async () => {
  if (!settings.loaded) void settings.load();
  await refresh();
  timer = setInterval(() => void loadLive(), 2000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.stats') }}</h1>
      <p class="muted">{{ t('stats.lead') }}</p>
      <button class="button button--ghost" type="button" data-action="stats-refresh" @click="refresh()">
        {{ t('stats.refresh') }}
      </button>
    </header>
    <p v-if="loadFailed" class="banner banner--error" role="alert">{{ t('stats.load_failed') }}</p>

    <div class="grid">
      <section class="card card--wide" data-card="M" data-feature="H-STAT-05" data-feature-2="H-V2STAT-04" aria-labelledby="stats-live-title">
        <h2 id="stats-live-title" class="card__title">{{ t('stats.live_title') }}</h2>
        <p v-if="!live.length" class="muted" data-stats-live-none>{{ t('stats.live_none') }}</p>
        <article v-for="s in live" :key="s.key" class="stats-session" :data-live-source="s.source">
          <h3 class="stats-session__title">
            {{ s.device || t('common.unknown') }}<template v-if="s.app"> · {{ s.app }}</template>
          </h3>
          <dl class="stats">
            <div v-for="row in liveRows(s)" :key="row.id" class="stats__row" :data-metric="row.id">
              <dt>{{ row.label }}</dt>
              <dd>
                <span class="stats__value">{{ row.value || t('stats.no_value') }}</span>
                <span v-if="row.value && row.grade !== 'info'" class="grade" :data-grade="row.grade">{{ t(`stats.grade_${row.grade}`) }}</span>
                <small class="muted stats__help">{{ row.help }}</small>
              </dd>
            </div>
          </dl>
          <p v-if="s.source === 'rtsp'" class="muted" data-live-rtsp-note>{{ t('stats.live_rtsp_note') }}</p>
        </article>
        <p class="muted" data-rtt-note>{{ t('stats.rtt_note') }}</p>
      </section>

      <section class="card" data-card="M" data-feature="H-STAT-03" data-feature-2="H-V2STAT-02" aria-labelledby="stats-host-title">
        <h2 id="stats-host-title" class="card__title">{{ t('stats.host_title') }}</h2>
        <p v-if="hostStatsOff" class="banner banner--info" role="status" data-feature="H-STAT-02">{{ t('stats.host_off') }}</p>
        <dl class="facts">
          <dt>{{ t('stats.host_cpu') }}</dt>
          <dd data-host="cpu">{{ pct(usage?.cpu) }}</dd>
          <dt>{{ t('stats.host_gpu') }}</dt>
          <dd data-host="gpu">{{ pct(usage?.gpu) }}</dd>
          <dt>{{ t('stats.host_encoder') }}</dt>
          <dd data-host="encoder">{{ pct(usage?.encoder) }}</dd>
        </dl>
        <small class="muted">{{ t('stats.host_help') }}</small>
      </section>

      <section class="card card--wide" data-card="M" data-feature="H-STAT-06" data-feature-2="H-V2STAT-05" aria-labelledby="stats-recent-title">
        <h2 id="stats-recent-title" class="card__title">{{ t('stats.recent_title') }}</h2>
        <p v-if="!historyOk" class="banner banner--warn" role="status" data-history-off>{{ t('stats.history_off') }}</p>
        <p v-else-if="!recent.length" class="muted" data-recent-none>{{ t('stats.recent_none') }}</p>
        <div v-if="recent.length" class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ t('stats.col_start') }}</th>
                <th scope="col">{{ t('stats.col_device') }}</th>
                <th scope="col">{{ t('stats.col_app') }}</th>
                <th scope="col">{{ t('stats.col_video') }}</th>
                <th scope="col">{{ t('stats.col_codec') }}</th>
                <th scope="col">{{ t('stats.col_length') }}</th>
                <th scope="col">{{ t('stats.col_verdict') }}</th>
                <th scope="col"><span class="sr-only">{{ t('stats.detail') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in recent" :key="s.uuid" :class="{ 'table__row--selected': s.uuid === detailUuid }" :data-recent="s.uuid">
                <td>{{ when(s.startUnix) }}</td>
                <td>{{ s.device || t('common.unknown') }}</td>
                <td>{{ s.app }}</td>
                <td>{{ size(s.width, s.height) }}<template v-if="s.targetFps">@{{ s.targetFps }}</template></td>
                <td>{{ s.codec }}</td>
                <td>{{ duration(s.durationSeconds) }}</td>
                <td><span class="grade" :data-grade="verdictGrade(s.verdict)">{{ t(`stats.verdict_${s.verdict}`) }}</span></td>
                <td>
                  <button
                    class="button button--ghost"
                    type="button"
                    :aria-expanded="s.uuid === detailUuid"
                    :aria-controls="s.uuid === detailUuid ? 'stats-detail' : undefined"
                    :data-detail="s.uuid"
                    @click="openDetail(s.uuid)"
                  >
                    {{ s.uuid === detailUuid ? t('stats.close_detail') : t('stats.detail') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <small class="muted">{{ t('stats.verdict_help') }}</small>
        <div class="row">
          <button v-if="recentMore" class="button button--ghost" type="button" data-action="recent-more" @click="loadRecent(true)">
            {{ t('stats.more') }}
          </button>
        </div>

        <div v-if="detailUuid" id="stats-detail" class="stats-detail" data-stats-detail>
          <h3 class="stats-session__title">
            {{ t('stats.detail_title', { name: detailSession?.app || detailSession?.device || t('common.unknown') }) }}
          </h3>
          <p v-if="detailState === 'loading'" class="muted">{{ t('common.loading') }}</p>
          <p v-else-if="detailState === 'failed'" class="banner banner--error" role="alert">{{ t('stats.d_failed') }}</p>
          <p v-else-if="detail && detail.count === 0" class="muted">{{ t('stats.d_no_samples') }}</p>
          <dl v-else-if="detail" class="stats">
            <div v-for="row in detailRows(detail, detailSession)" :key="row.id" class="stats__row" :data-metric="row.id">
              <dt>{{ row.label }}</dt>
              <dd>
                <span class="stats__value">{{ row.value || t('stats.no_value') }}</span>
                <span v-if="row.value && row.grade !== 'info'" class="grade" :data-grade="row.grade">{{ t(`stats.grade_${row.grade}`) }}</span>
                <small class="muted stats__help">{{ row.help }}</small>
              </dd>
            </div>
          </dl>
        </div>

        <details class="details" data-advanced>
          <summary>{{ t('stats.settings_title') }}</summary>
          <label class="switch" data-feature="H-SET-173">
            <input
              type="checkbox"
              role="switch"
              :checked="settings.draft.session_history_enabled"
              :disabled="!!toggleReason"
              :aria-describedby="toggleReason ? 'reason-history' : 'help-history'"
              data-setting="session_history_enabled"
              @change="settings.set('session_history_enabled', ($event.target as HTMLInputElement).checked)"
            />
            <span>
              <strong>{{ t('stats.history_enabled') }}</strong>
              <small id="help-history" class="muted">{{ t('stats.history_enabled_help') }}</small>
            </span>
          </label>
          <ReasonText id="reason-history" :reason="toggleReason" />
          <label class="field" data-feature="H-SET-174">
            <span>{{ t('stats.history_ttl') }}</span>
            <input
              class="input input--short"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              :value="settings.draft.session_history_ttl_days"
              aria-describedby="help-history-ttl"
              data-setting="session_history_ttl_days"
              @change="setDays"
            />
            <small id="help-history-ttl" class="muted">{{ t('stats.history_ttl_help') }}</small>
          </label>
        </details>
      </section>
    </div>
  </div>
</template>
