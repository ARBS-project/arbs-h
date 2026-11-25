<script setup lang="ts">
// ARBS-H UI1b card T "문제 해결": H-NAV-07, H-TRBL-01/02/04/07, H-V2LOG-01/02/03, H-V2MNT-03/08.
// D-UI-3 R8 (nothing running), R10 (no crash dump), R13 (no search text), R14 (Windows only).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { apiGet, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import {
  filterLines,
  LOG_SOURCES,
  matchIndexes,
  parseLog,
  stepMatch,
  summary,
  type LogLine,
  type Severity,
} from '@/logic/logs';
import { crashReason, firstReason, isWindows, offlineReason, runningReason, searchReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const host = useHostStore();
const ui = useUiStore();

const source = ref<(typeof LOG_SOURCES)[number]>('sunshine');
const severity = ref<Severity>('all');
const query = ref('');
const lines = ref<LogLine[]>([]);
const following = ref(true);
const current = ref(-1);
const crashParts = ref<{ index: number; filename?: string }[]>([]);
const service = ref<{ installed?: boolean; automatic?: boolean; start_type?: string; can_change?: boolean } | null>(null);
const busy = ref('');
const viewer = ref<HTMLElement | null>(null);
let timer: number | undefined;

const windows = computed(() => isWindows(host.metadata?.platform ?? 'windows'));
const offline = computed(() => offlineReason(host.online));
const visible = computed(() => filterLines(lines.value, severity.value));
const matches = computed(() => matchIndexes(visible.value, query.value));
const counts = computed(() => summary(lines.value));
const closeReason = computed(() => firstReason(offline.value, runningReason(host.session)));
const stepReason = computed(() => searchReason(query.value, matches.value.length));
const crashDisabled = computed(() => firstReason(offline.value, crashReason(crashParts.value.length)));

async function loadLogs(): Promise<void> {
  try {
    const text = await apiGet<string>(`/api/logs?source=${encodeURIComponent(source.value)}&tail=2000`);
    lines.value = parseLog(typeof text === 'string' ? text : '');
    if (following.value) {
      await nextTick();
      viewer.value?.scrollTo({ top: viewer.value.scrollHeight });
    }
  } catch {
    lines.value = [];
  }
}

async function loadCrash(): Promise<void> {
  if (!windows.value) return;
  try {
    const manifest = await apiGet<{ parts?: { index?: number; filename?: string }[] }>('/api/logs/export_crash/manifest');
    crashParts.value = (manifest?.parts ?? [])
      .filter((p) => Number.isInteger(p.index) && (p.index ?? 0) > 0)
      .map((p) => ({ index: p.index as number, filename: p.filename }));
  } catch {
    crashParts.value = [];
  }
}

async function loadService(): Promise<void> {
  if (!windows.value) return;
  try {
    service.value = await apiGet('/api/service/startup');
  } catch {
    service.value = null;
  }
}

async function setAutomatic(automatic: boolean): Promise<void> {
  busy.value = 'service';
  try {
    service.value = await apiPost('/api/service/startup', { automatic });
    ui.say(t('trouble.service_saved'));
  } catch {
    ui.say(t('common.failed'), 'error');
    await loadService();
  } finally {
    busy.value = '';
  }
}

async function forceClose(): Promise<void> {
  busy.value = 'close';
  try {
    await apiPost('/api/apps/close', {});
    ui.say(t('trouble.closed'));
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
    void host.refreshHost();
  }
}

async function restart(): Promise<void> {
  if (!window.confirm(t('trouble.restart_confirm'))) return;
  await host.restart();
}

function step(direction: 1 | -1): void {
  current.value = stepMatch(current.value, matches.value.length, direction);
  const row = matches.value[current.value];
  if (row === undefined) return;
  following.value = false;
  viewer.value?.querySelector(`[data-row="${row}"]`)?.scrollIntoView({ block: 'center' });
}

function newest(): void {
  following.value = true;
  viewer.value?.scrollTo({ top: viewer.value.scrollHeight });
}

async function copyVisible(): Promise<void> {
  try {
    await navigator.clipboard.writeText(visible.value.map((l) => l.text).join('\n'));
    ui.say(t('trouble.copied'));
  } catch {
    ui.say(t('common.failed'), 'error');
  }
}

function startTimer(): void {
  window.clearInterval(timer);
  if (following.value) timer = window.setInterval(() => void loadLogs(), 5000);
}

watch(source, () => void loadLogs());
watch(following, startTimer);
watch(query, () => (current.value = -1));
onMounted(async () => {
  await Promise.all([loadLogs(), loadCrash(), loadService()]);
  startTimer();
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.troubleshoot') }}</h1>
      <p class="muted">{{ t('trouble.lead') }}</p>
    </header>

    <div class="grid">
      <section class="card" data-card="T">
        <h2 class="card__title">{{ t('trouble.actions') }}</h2>
        <div data-feature="H-TRBL-01">
          <button
            class="button button--danger"
            type="button"
            :disabled="!!busy || !!closeReason"
            :aria-disabled="!!closeReason"
            :aria-describedby="closeReason ? 'reason-close' : 'help-close'"
            data-action="force-close"
            @click="forceClose()"
          >
            {{ t('trouble.force_close') }}
          </button>
          <small id="help-close" class="muted">{{ t('trouble.force_close_help') }}</small>
          <ReasonText id="reason-close" :reason="closeReason" />
        </div>
        <div class="divider"></div>
        <div data-feature="H-TRBL-02">
          <button class="button button--primary" type="button" :disabled="!!offline" data-action="restart" @click="restart()">
            {{ t('common.restart') }}
          </button>
          <small class="muted">{{ t('trouble.restart_help') }}</small>
        </div>
      </section>

      <section v-if="windows" class="card" data-card="T" data-feature="H-V2MNT-08">
        <h2 class="card__title">{{ t('trouble.startup') }}</h2>
        <p class="muted">
          {{ t('trouble.startup_mode') }}:
          <strong>{{ service ? t(`trouble.start_${service.start_type || 'unknown'}`) : t('common.unknown') }}</strong>
        </p>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            :checked="!!service?.automatic"
            :disabled="!!busy || !service?.can_change || !!offline"
            :aria-describedby="!service?.can_change ? 'reason-service' : undefined"
            @change="setAutomatic(($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ t('trouble.start_with_windows') }}</strong>
            <small class="muted">{{ t('trouble.start_with_windows_help') }}</small>
          </span>
        </label>
        <ReasonText id="reason-service" :reason="service && !service.can_change ? 'reason.service_locked' : null" />
        <p class="muted">{{ t('trouble.restart_also') }}</p>
      </section>

      <section class="card" data-card="T" data-feature="H-V2MNT-03" data-feature-2="H-TRBL-04">
        <h2 class="card__title">{{ t('trouble.bundles') }}</h2>
        <div class="row">
          <a class="button button--ghost" href="/api/logs/export" download data-action="export-logs">{{ t('trouble.export_logs') }}</a>
        </div>
        <div v-if="windows">
          <p class="muted">{{ t('trouble.crash_help') }}</p>
          <div class="row">
            <a
              v-for="part in crashParts"
              :key="part.index"
              class="button button--ghost"
              :href="`/api/logs/export_crash?part=${part.index}`"
              download
            >
              {{ t('trouble.crash_part', { index: part.index }) }}
            </a>
            <button
              v-if="!crashParts.length"
              class="button button--ghost"
              type="button"
              disabled
              aria-disabled="true"
              aria-describedby="reason-crash"
            >
              {{ t('trouble.crash_download') }}
            </button>
          </div>
          <ReasonText id="reason-crash" :reason="crashDisabled" />
        </div>
      </section>

      <section class="card card--wide" data-card="T" data-feature="H-TRBL-07" data-feature-2="H-V2LOG-01">
        <h2 class="card__title">{{ t('trouble.logs') }}</h2>
        <div class="toolbar" data-feature="H-V2LOG-02">
          <label class="field field--inline">
            <span>{{ t('trouble.source') }}</span>
            <select v-model="source" class="input">
              <option v-for="s in LOG_SOURCES" :key="s" :value="s">{{ t(`trouble.source_${s}`) }}</option>
            </select>
          </label>
          <label class="field field--inline">
            <span>{{ t('trouble.severity') }}</span>
            <select v-model="severity" class="input">
              <option v-for="v in ['all', 'error', 'warning', 'info', 'debug']" :key="v" :value="v">{{ t(`trouble.sev_${v}`) }}</option>
            </select>
          </label>
          <label class="field field--inline">
            <span>{{ t('trouble.search') }}</span>
            <input v-model="query" class="input" type="search" />
          </label>
          <button
            class="button button--ghost"
            type="button"
            :disabled="!!stepReason"
            :aria-describedby="stepReason ? 'reason-search' : undefined"
            @click="step(-1)"
          >
            {{ t('trouble.prev') }}
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="!!stepReason"
            :aria-describedby="stepReason ? 'reason-search' : undefined"
            @click="step(1)"
          >
            {{ t('trouble.next') }}
          </button>
          <span class="muted">{{ matches.length ? `${current + 1 > 0 ? current + 1 : 0}/${matches.length}` : '' }}</span>
        </div>
        <ReasonText id="reason-search" :reason="query.trim() ? stepReason : null" />
        <div class="toolbar">
          <span class="muted" role="status">{{ following ? t('trouble.following') : t('trouble.paused') }}</span>
          <button class="button button--ghost" type="button" @click="following = !following">
            {{ following ? t('trouble.pause') : t('trouble.resume') }}
          </button>
          <button class="button button--ghost" type="button" @click="loadLogs()">{{ t('trouble.refresh') }}</button>
          <button class="button button--ghost" type="button" @click="newest()">{{ t('trouble.newest') }}</button>
        </div>
        <p class="muted" data-feature="H-V2LOG-03">
          {{ t('trouble.summary', { errors: counts.errors, warnings: counts.warnings, total: counts.total }) }}
          <button class="button button--link" type="button" :disabled="!visible.length" @click="copyVisible()">{{ t('trouble.copy') }}</button>
          <a href="/api/logs/export" download>{{ t('trouble.bundle') }}</a>
        </p>
        <div ref="viewer" class="log" tabindex="0" :aria-label="t('trouble.logs')">
          <div
            v-for="(line, i) in visible"
            :key="line.index"
            class="log__line"
            :data-row="i"
            :data-level="line.level"
            :class="{ 'log__line--match': matches[current] === i }"
          >
            {{ line.text }}
          </div>
          <p v-if="!visible.length" class="muted">{{ t('trouble.empty') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
