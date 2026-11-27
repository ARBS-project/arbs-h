<script setup lang="ts">
// ARBS-H 0.3.0 (NET2): "외부 접속" wizard, docs/analysis/NET2.md §3 (steps 0..5; 3a Tailscale, 3b port forwarding,
// 3c UPnP, 3d port change). Only the WIZARD_KEYS are PATCHed, the value before is shown next to every change and step 5
// puts it back. Addresses are hidden (●●●) and shown only while "보기" is held: never stored, logged or sent.
// 0.3.1 (H031, docs/analysis/H031.md §1-2): one "보기" component for every address (pointer captured while pressed),
// 3b = router settings only, 4 = "밖에서 접속" (router's outside address read-only from the router or typed in, value for
// Moonlight, PIN, new pairing off, result), 5 = "마무리" (summary; changed settings only inside a closed advanced box).
// Step IDs are unchanged (bookmarks and the ?step=5&prev_port= link after a port change keep working).
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { apiGet, apiPatch } from '@/api/client';
import HoldReveal from '@/components/HoldReveal.vue';
import ReasonText from '@/components/ReasonText.vue';
import RemoteDiagram from '@/components/RemoteDiagram.vue';
import type { PatchResult } from '@/logic/config';
import {
  ARBS_PORT,
  CHANGES_KEY,
  checkPort,
  checks,
  DEFAULT_PORT,
  diagnosticsFromConfig,
  easyValue,
  EXTERNAL_CHECK_URL,
  finishSummary,
  hostKind,
  MASK,
  moonlightAddress,
  neverOpen,
  newWebUiUrl,
  originOf,
  outsideValue,
  overlapsSunshineDefault,
  parsePrevPort,
  parseStep,
  parseVia,
  PROGRESS_KEY,
  readChanges,
  readDiagnostics,
  readProgress,
  readRouterWan,
  recommend,
  recordChange,
  restoreBlockReason,
  ROUTER_GUIDE_LINKS,
  serverBool,
  STACKON_GUIDE_URL,
  STEPS,
  streamPorts,
  TAILSCALE_CONNECTION_URL,
  TAILSCALE_URL,
  upnpBlockReason,
  wizardPatch,
  ZEROTIER_URL,
  type Answer,
  type Change,
  type Diagnostics,
  type Progress,
  type RouterWan,
  type Step,
  type Via,
  type WizardKey,
} from '@/logic/remote';
import { useHostStore } from '@/stores/host';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const host = useHostStore();
const ui = useUiStore();

const config = ref<Record<string, unknown>>({});
const diag = ref<Diagnostics | null>(null);
const loading = ref(false);
const busy = ref('');
const restartNeeded = ref(false);
const movedTo = ref<{ url: string; port: number } | null>(null);
const routerAnswer = ref<Answer>('unknown');
const wanAnswer = ref<Answer>('unknown');
const newPort = ref(String(ARBS_PORT));
// Router's outside address: screen memory only (never stored, put in the address bar or logged).
const wan = ref<RouterWan | null>(null);
const wanAsking = ref(false);
const manual = ref('');

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const changes = ref<Change[]>(readChanges(storage()?.getItem(CHANGES_KEY) ?? null));
watch(changes, (list) => storage()?.setItem(CHANGES_KEY, JSON.stringify(list)), { deep: true });
// Method and result only (no address): kept for the "마무리" summary.
const progress = ref<Progress>(readProgress(storage()?.getItem(PROGRESS_KEY) ?? null));
watch(progress, (p) => storage()?.setItem(PROGRESS_KEY, JSON.stringify(p)), { deep: true });

const step = computed<Step>(() => parseStep(route.query.step));
const via = computed<Via>(() => parseVia(route.query.via) ?? progress.value.via);
const base = computed(() => diag.value?.port ?? DEFAULT_PORT);
const where = computed(() => hostKind(window.location.hostname));
const list = computed(() => (diag.value ? checks(diag.value, where.value) : []));
const ports = computed(() => streamPorts(base.value));
const never = computed(() => neverOpen(base.value));
const advice = computed(() => recommend(routerAnswer.value, wanAnswer.value, where.value, diag.value?.upnp.wanKind ?? 'unknown'));
const originWan = computed(() => diag.value?.originWan ?? originOf(config.value) === 'wan');
const upnpOn = computed(() => serverBool(config.value.upnp, false));
const pairingOn = computed(() => serverBool(config.value.enable_pairing, true));
const lanEnc = computed(() => raw('lan_encryption_mode') || '0');
const upnpReason = computed(() => upnpBlockReason(originWan.value));
const tailnet = computed(() => {
  const all = diag.value?.interfaces ?? [];
  return all.find((i) => i.tailscaleLike && i.kind === 'cgnat_v4') ?? all.find((i) => i.kind === 'cgnat_v4') ?? all.find((i) => i.tailscaleLike) ?? null;
});
const local = computed(() => diag.value?.interfaces.find((i) => i.kind === 'private_v4') ?? null);
const portCheck = computed(() => checkPort(newPort.value, base.value));
const preview = computed(() => (portCheck.value.error === null && portCheck.value.port !== null ? streamPorts(portCheck.value.port) : null));
const guides = computed(() => ROUTER_GUIDE_LINKS.map((g) => ({ ...g, label: t(`remote.g_${g.id}`) })));
const wanPublic = computed(() => wan.value?.state === 'ok' && wan.value.kind === 'public' && wan.value.address !== null);
const wanNotPublic = computed(() => wan.value?.state === 'ok' && (wan.value.kind === 'private' || wan.value.kind === 'cgnat'));
const manualOut = computed(() => outsideValue(manual.value, base.value));
const summary = computed(() => finishSummary(progress.value, base.value, pairingOn.value));
const prevPortLink = computed(() => parsePrevPort(route.query.prev_port) !== null);

function raw(key: WizardKey): string {
  const value = config.value[key];
  return value === undefined || value === null ? '' : String(value);
}

/** S3 on step 5: "이전 값으로" that would give UPnP on + origin = wan is disabled with this reason. */
function revertReason(c: Change): string | null {
  return restoreBlockReason(c.key, c.before, config.value, diag.value?.originWan ?? false);
}

/** Plain words for a setting value (0.3.1: never the raw config word on the screen). */
function valueText(key: WizardKey, value: string): string {
  const v = easyValue(key, value);
  return 'text' in v ? t(v.text) : v.raw;
}

const forMoonlight = (plain: string): string => moonlightAddress(plain, base.value);

async function load(): Promise<void> {
  loading.value = true;
  try {
    config.value = (await apiGet<Record<string, unknown>>('/api/config')) ?? {};
  } catch {
    config.value = {};
  }
  try {
    diag.value = readDiagnostics(await apiGet<unknown>('/api/network/diagnostics', { signal: AbortSignal.timeout(8000) }), config.value);
  } catch {
    diag.value = diagnosticsFromConfig(config.value);
  } finally {
    loading.value = false;
  }
}

/** P-4: asked once when step 4 opens (not for Tailscale) and again with "다시 물어보기". Read only, no mapping. */
async function askRouter(): Promise<void> {
  if (wanAsking.value) return;
  wanAsking.value = true;
  try {
    wan.value = readRouterWan(await apiGet<unknown>('/api/network/router-wan', { signal: AbortSignal.timeout(10000) }));
  } catch {
    wan.value = { state: 'error', kind: 'unknown', address: null };
  } finally {
    wanAsking.value = false;
  }
}

watch(
  () => [step.value, via.value] as const,
  ([s, v], old) => {
    const entered = !old || old[0] !== '4';
    if (s === '4' && v !== 'tailscale' && entered) void askRouter();
  },
  { immediate: true },
);

function go(next: Step, nextVia?: Via): void {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) if (typeof v === 'string') query[k] = v;
  query.step = next;
  if (nextVia) {
    query.via = nextVia;
    progress.value = { ...progress.value, via: nextVia };
  }
  void router.replace({ path: '/remote', query });
  window.scrollTo(0, 0);
}

function setResult(r: 'ok' | 'fail'): void {
  progress.value = { ...progress.value, via: via.value, result: r };
}

/** One wizard change (or "이전 값으로"): PATCH the key, remember the first value before it. */
async function change(key: WizardKey, value: string, restore = false): Promise<void> {
  const before = raw(key);
  let body: Record<string, string>;
  try {
    body = wizardPatch(key, value, restore, config.value, diag.value?.originWan ?? false);
  } catch {
    ui.say(t('common.failed'), 'error');
    return;
  }
  busy.value = key;
  try {
    const answer = await apiPatch<PatchResult>('/api/config', body);
    if (answer && answer.status === false) throw new Error('rejected');
    changes.value = recordChange(changes.value, key, before, value);
    if (key === 'port') {
      const port = Number(value) || DEFAULT_PORT;
      movedTo.value = { url: newWebUiUrl(window.location.hostname, port, base.value), port: port + 1 };
      ui.movedTo = movedTo.value.url;
      ui.movedPort = movedTo.value.port;
    }
    if (answer?.restartRequired || key === 'port' || key === 'upnp') restartNeeded.value = true;
    ui.say(t(restartNeeded.value ? 'remote.restart_needed' : 'remote.saved'));
    await load();
  } catch {
    ui.say(t('common.failed'), 'error');
  } finally {
    busy.value = '';
  }
}

onMounted(async () => {
  await load();
  // Back from a port change: the old web UI port came in ?prev_port= (sessionStorage does not follow a new origin).
  const prev = parsePrevPort(route.query.prev_port);
  if (prev !== null && prev !== base.value && !changes.value.some((c) => c.key === 'port')) {
    changes.value = recordChange(changes.value, 'port', String(prev), String(base.value));
  }
});
</script>

<template>
  <div class="page remote" data-page="remote">
    <header class="page__head">
      <h1>{{ t('remote.title') }}</h1>
      <p class="muted">{{ t('remote.lead') }}</p>
    </header>

    <nav class="remote__steps" :aria-label="t('remote.steps_label')">
      <button
        v-for="s in STEPS"
        :key="s"
        type="button"
        class="remote__step"
        :class="{ 'remote__step--sub': s.length > 1 }"
        :aria-current="step === s ? 'step' : undefined"
        :data-step-link="s"
        @click="go(s)"
      >
        {{ t(`remote.step_${s}`) }}
      </button>
    </nav>

    <section class="banner banner--error remote__never" data-never-open role="note">
      <p><strong>{{ t('remote.never_title') }}</strong></p>
      <ul class="remote__never-list">
        <li v-for="n in never" :key="n.why" :data-never="n.why">
          {{ n.why === 'web_ui' ? t('remote.never_web_ui', { port: n.port }) : t('remote.never_usbip', { port: n.port }) }}
        </li>
      </ul>
      <p class="muted">{{ t('remote.never_help') }}</p>
    </section>

    <p v-if="loading && !diag" class="muted">{{ t('common.loading') }}</p>

    <!-- 0 start -->
    <section v-if="step === '0'" class="card" data-remote-step="0">
      <h2 class="card__title">{{ t('remote.s0_title') }}</h2>
      <RemoteDiagram kind="overview" />
      <p>{{ t('remote.s0_text') }}</p>
      <p data-base-port>{{ t('remote.s0_port', { port: base }) }}</p>
      <p v-if="!overlapsSunshineDefault(base)" class="muted" data-arbs-port-note>{{ t('remote.s0_port_arbs') }}</p>
      <div class="row">
        <button class="button button--primary" type="button" @click="go('1')">{{ t('remote.s0_start') }}</button>
      </div>
    </section>

    <!-- 1 check -->
    <section v-if="step === '1'" class="card" data-remote-step="1">
      <h2 class="card__title">{{ t('remote.s1_title') }}</h2>
      <p class="muted">{{ t('remote.s1_lead') }}</p>
      <p v-if="diag?.source === 'config'" class="banner banner--warn" data-diag-fallback>{{ t('remote.s1_fallback') }}</p>
      <ul class="list remote__checks">
        <li v-for="c in list" :key="c.id" class="list__row" :data-check="c.id" :data-check-grade="c.grade">
          <span class="list__grow">{{ t(c.text) }}</span>
          <span class="grade" :data-grade="c.grade">{{ t(`remote.grade_${c.grade}`) }}</span>
          <button v-if="c.id === 'overlap' && c.grade === 'warn'" class="button button--link" type="button" data-go-3d @click="go('3d')">
            {{ t('remote.step_3d') }}
          </button>
          <button
            v-if="c.id === 'risk' && c.grade === 'bad'"
            class="button button--ghost"
            type="button"
            :disabled="!!busy || !host.online"
            data-action="origin-lan"
            @click="change('origin_web_ui_allowed', 'lan')"
          >
            {{ t('remote.origin_to_lan') }}
          </button>
        </li>
      </ul>
      <div class="row">
        <button class="button button--ghost" type="button" :disabled="loading" @click="load()">{{ t('remote.s1_reload') }}</button>
        <button class="button button--primary" type="button" @click="go('2')">{{ t('remote.next') }}</button>
      </div>
    </section>

    <!-- 2 choose -->
    <section v-if="step === '2'" class="card" data-remote-step="2">
      <h2 class="card__title">{{ t('remote.s2_title') }}</h2>
      <p><strong>{{ t('remote.s2_recommend') }}</strong></p>
      <p class="muted">{{ t('remote.s2_other') }}</p>
      <fieldset class="fieldset">
        <legend>{{ t('remote.s2_q_router') }}</legend>
        <div class="segmented" role="radiogroup" :aria-label="t('remote.s2_q_router')">
          <label v-for="a in ['yes', 'no', 'unknown'] as const" :key="a" class="check">
            <input v-model="routerAnswer" type="radio" name="remote-router" :value="a" :data-answer-router="a" />
            <span>{{ t(`remote.a_${a}`) }}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="fieldset">
        <legend>{{ t('remote.s2_q_wan') }}</legend>
        <div class="segmented" role="radiogroup" :aria-label="t('remote.s2_q_wan')">
          <label v-for="a in ['yes', 'no', 'unknown'] as const" :key="a" class="check">
            <input v-model="wanAnswer" type="radio" name="remote-wan" :value="a" :data-answer-wan="a" />
            <span>{{ t(`remote.a_${a}`) }}</span>
          </label>
        </div>
      </fieldset>
      <p class="banner banner--ok" :data-recommend="advice.method">
        {{ advice.method === 'tailscale' ? t('remote.s2_result_tailscale') : t('remote.s2_result_forward') }}
      </p>
      <p v-for="n in advice.notes" :key="n" class="muted" :data-note="n">{{ t(`remote.n_${n}`) }}</p>
      <div class="grid remote__methods">
        <div class="card remote__method" data-method="tailscale">
          <h3 class="card__title">{{ t('remote.m_tailscale') }}</h3>
          <p class="muted">{{ t('remote.m_tailscale_text') }}</p>
          <button class="button button--primary" type="button" @click="go('3a', 'tailscale')">{{ t('remote.go_3a') }}</button>
        </div>
        <div class="card remote__method" data-method="forward">
          <h3 class="card__title">{{ t('remote.m_forward') }}</h3>
          <p class="muted">{{ t('remote.m_forward_text') }}</p>
          <button class="button button--ghost" type="button" @click="go('3b', 'forward')">{{ t('remote.go_3b') }}</button>
        </div>
        <div class="card remote__method" data-method="upnp">
          <h3 class="card__title">{{ t('remote.m_upnp') }}</h3>
          <p class="muted">{{ t('remote.m_upnp_text') }}</p>
          <button class="button button--ghost" type="button" @click="go('3c', 'upnp')">{{ t('remote.go_3c') }}</button>
        </div>
        <div class="card remote__method" data-method="port">
          <h3 class="card__title">{{ t('remote.m_port') }}</h3>
          <p class="muted">{{ t('remote.m_port_text') }}</p>
          <button class="button button--ghost" type="button" @click="go('3d')">{{ t('remote.go_3d') }}</button>
        </div>
      </div>
    </section>

    <!-- 3a Tailscale -->
    <section v-if="step === '3a'" class="card" data-remote-step="3a">
      <h2 class="card__title">{{ t('remote.s3a_title') }}</h2>
      <RemoteDiagram kind="vpn" />
      <ol class="steps">
        <li>
          {{ t('remote.s3a_1') }}
          <span class="remote__links">
            <a :href="TAILSCALE_URL" target="_blank" rel="noopener noreferrer" data-link="tailscale">{{ t('remote.s3a_link') }}</a>
            <a :href="ZEROTIER_URL" target="_blank" rel="noopener noreferrer" data-link="zerotier">{{ t('remote.s3a_link_zerotier') }}</a>
          </span>
        </li>
        <li>
          {{ t('remote.s3a_2') }}
          <HoldReveal v-if="tailnet" data-tailnet :value="tailnet.address" :label="t('remote.addr_label')" :format="forMoonlight" copy />
          <p v-else class="banner banner--warn" data-tailnet-none>{{ t('remote.s3a_no_addr') }}</p>
          <p v-if="base !== DEFAULT_PORT" class="muted" data-port-suffix>{{ t('remote.port_suffix_note', { port: base }) }}</p>
          <p class="muted">{{ t('remote.share_warning') }}</p>
        </li>
        <li>
          {{ t('remote.s3a_3') }}
          <a :href="TAILSCALE_CONNECTION_URL" target="_blank" rel="noopener noreferrer">{{ t('remote.s3a_conn_link') }}</a>
        </li>
        <li>
          {{ t('remote.s3a_4') }}
          <RouterLink to="/devices/pair">{{ t('pair.title') }}</RouterLink>
        </li>
      </ol>
      <p class="muted" data-web-via-tailnet>{{ where === 'cgnat' ? t('remote.s3a_web_yes') : t('remote.s3a_web_no') }}</p>
      <div class="divider"></div>
      <h3 class="card__title">{{ t('remote.s3a_enc_title') }}</h3>
      <p class="muted">{{ t('remote.s3a_enc') }}</p>
      <p data-lan-enc>{{ t('remote.now_value', { value: valueText('lan_encryption_mode', lanEnc) }) }}</p>
      <div class="row">
        <button
          v-if="lanEnc === '0'"
          class="button button--ghost"
          type="button"
          :disabled="!!busy || !host.online"
          data-action="lan-enc-on"
          @click="change('lan_encryption_mode', '1')"
        >
          {{ t('remote.enc_on') }}
        </button>
        <button
          v-else-if="lanEnc === '1'"
          class="button button--ghost"
          type="button"
          :disabled="!!busy || !host.online"
          data-action="lan-enc-off"
          @click="change('lan_encryption_mode', '0')"
        >
          {{ t('remote.enc_off') }}
        </button>
      </div>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" data-next-4 @click="go('4', 'tailscale')">{{ t('remote.next_4') }}</button>
      </div>
    </section>

    <!-- 3b port forwarding: router settings only (H031 F2) -->
    <section v-if="step === '3b'" class="card" data-remote-step="3b">
      <h2 class="card__title">{{ t('remote.s3b_title') }}</h2>
      <p class="banner banner--ok" data-3b-lead>{{ t('remote.s3b_lead') }}</p>
      <RemoteDiagram kind="forward" />
      <ol class="steps">
        <li>
          {{ t('remote.s3b_1') }}
          <HoldReveal v-if="local" data-local :value="local.address" :label="t('remote.s3b_local')" />
        </li>
        <li>
          {{ t('remote.s3b_2') }}
          <div class="table-wrap">
            <table class="table" data-port-table>
              <thead>
                <tr>
                  <th scope="col">{{ t('remote.th_proto') }}</th>
                  <th scope="col">{{ t('remote.th_port') }}</th>
                  <th scope="col">{{ t('remote.th_use') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in ports.tcp" :key="`tcp-${p.port}`" :data-row="`tcp-${p.port}`">
                  <td>TCP</td>
                  <td>{{ p.port }}</td>
                  <td>{{ t(`remote.role_${p.role}`) }}</td>
                </tr>
                <tr v-for="p in ports.udp" :key="`udp-${p.port}`" :data-row="`udp-${p.port}`">
                  <td>UDP</td>
                  <td>{{ p.port }}</td>
                  <td>{{ t(`remote.role_${p.role}`) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>
        <li data-3b-double>
          {{ t('remote.s3b_3') }}
          <h3 class="card__title">{{ t('remote.s3b_guides') }}</h3>
          <ul class="remote__guides">
            <li v-for="g in guides" :key="g.id">
              <a :href="g.url" target="_blank" rel="noopener noreferrer" :data-guide="g.id">{{ g.label }}</a>
            </li>
            <li v-if="STACKON_GUIDE_URL">
              <a :href="STACKON_GUIDE_URL" target="_blank" rel="noopener noreferrer" data-guide="stackon">{{ t('remote.g_stackon') }}</a>
            </li>
          </ul>
          <p class="muted">{{ t('remote.s3b_guides_other') }}</p>
        </li>
      </ol>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" data-next-4 @click="go('4', 'forward')">{{ t('remote.next_4') }}</button>
      </div>
    </section>

    <!-- 3c UPnP -->
    <section v-if="step === '3c'" class="card" data-remote-step="3c">
      <h2 class="card__title">{{ t('remote.s3c_title') }}</h2>
      <p class="banner banner--warn">{{ t('remote.s3c_warn') }}</p>
      <p><strong>{{ t('remote.s3c_policy') }}</strong></p>
      <p class="muted">{{ t('remote.s3c_restart') }}</p>
      <p data-upnp-now>{{ t('remote.now_value', { value: upnpOn ? t('remote.v_enabled') : t('remote.v_disabled') }) }}</p>
      <p v-if="diag && diag.upnp.enabled" class="muted" data-upnp-status>
        {{ t('remote.s3c_status', { state: t(`remote.igd_${diag.upnp.igd}`), ok: diag.upnp.mappedOk, total: diag.upnp.mappedTotal }) }}
      </p>
      <div class="row">
        <button
          v-if="!upnpOn"
          class="button button--ghost"
          type="button"
          :disabled="!!busy || !host.online || !!upnpReason"
          :aria-disabled="!!upnpReason"
          :aria-describedby="upnpReason ? 'reason-upnp' : undefined"
          data-action="upnp-on"
          @click="change('upnp', 'enabled')"
        >
          {{ t('remote.upnp_on') }}
        </button>
        <button
          v-else
          class="button button--ghost"
          type="button"
          :disabled="!!busy || !host.online"
          data-action="upnp-off"
          @click="change('upnp', 'disabled')"
        >
          {{ t('remote.upnp_off') }}
        </button>
        <button
          v-if="originWan"
          class="button button--ghost"
          type="button"
          :disabled="!!busy || !host.online"
          data-action="origin-lan"
          @click="change('origin_web_ui_allowed', 'lan')"
        >
          {{ t('remote.origin_to_lan') }}
        </button>
      </div>
      <ReasonText id="reason-upnp" :reason="upnpOn ? null : upnpReason" />
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" data-next-4 @click="go('4', 'upnp')">{{ t('remote.next_4') }}</button>
      </div>
    </section>

    <!-- 3d port change -->
    <section v-if="step === '3d'" class="card" data-remote-step="3d">
      <h2 class="card__title">{{ t('remote.s3d_title') }}</h2>
      <p class="banner banner--ok" data-port-benefit>{{ t('remote.s3d_benefit') }}</p>
      <p data-port-now>{{ t('remote.s3d_now', { port: base }) }}</p>
      <label class="field">
        <span>{{ t('remote.s3d_new') }}</span>
        <input
          v-model="newPort"
          class="input input--short"
          inputmode="numeric"
          autocomplete="off"
          data-field="new-port"
          :aria-invalid="portCheck.error ? 'true' : undefined"
          :aria-describedby="portCheck.error ? 'reason-port' : undefined"
        />
      </label>
      <p v-if="portCheck.error" id="reason-port" class="reason" data-port-error>{{ t(`remote.e_${portCheck.error}`) }}</p>
      <ul v-if="portCheck.warnings.length" class="list list--warn">
        <li v-for="w in portCheck.warnings" :key="w" :data-port-warning="w">{{ t(`remote.w_${w}`) }}</li>
      </ul>
      <div class="row">
        <button class="button button--ghost" type="button" data-action="port-arbs" @click="newPort = String(ARBS_PORT)">
          {{ t('remote.use_arbs', { port: ARBS_PORT }) }}
        </button>
        <button class="button button--ghost" type="button" data-action="port-default" @click="newPort = String(DEFAULT_PORT)">
          {{ t('remote.use_default', { port: DEFAULT_PORT }) }}
        </button>
      </div>
      <template v-if="preview">
        <h3 class="card__title">{{ t('remote.s3d_preview') }}</h3>
        <p class="muted" data-port-preview>
          TCP {{ preview.tcp.map((p) => p.port).join(', ') }} · UDP {{ preview.udp.map((p) => p.port).join(', ') }}
        </p>
      </template>
      <h3 class="card__title">{{ t('remote.s3d_effects') }}</h3>
      <ul class="steps">
        <li>{{ t('remote.s3d_e1') }}</li>
        <li>{{ t('remote.s3d_e2') }}</li>
        <li>{{ t('remote.s3d_e3', { port: (portCheck.port ?? base) + 1 }) }}</li>
      </ul>
      <p class="muted" data-port-before>{{ t('remote.before_value', { value: valueText('port', raw('port')) }) }}</p>
      <div class="row">
        <button
          class="button button--primary"
          type="button"
          :disabled="!!busy || !host.online || !!portCheck.error || portCheck.port === base"
          data-action="port-save"
          @click="change('port', String(portCheck.port))"
        >
          {{ t('remote.save_port') }}
        </button>
      </div>
      <div v-if="movedTo" class="banner banner--ok" data-moved>
        <p>{{ t('remote.s3d_saved') }}</p>
        <p>
          {{ t('remote.new_link') }}:
          <a :href="movedTo.url" data-new-link>https://{{ MASK }}:{{ movedTo.port }}/arbs/remote</a>
        </p>
      </div>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" @click="go('4')">{{ t('remote.next_4') }}</button>
      </div>
    </section>

    <!-- 4 try from outside (H031 F3) -->
    <section v-if="step === '4'" class="card" data-remote-step="4" :data-via="via">
      <h2 class="card__title">{{ t('remote.s4_title') }}</h2>
      <ol class="steps">
        <li data-s4="network">{{ t('remote.s4_1') }}</li>
        <li data-s4="value">
          {{ t('remote.s4_2') }}
          <template v-if="via === 'tailscale'">
            <HoldReveal v-if="tailnet" data-s4-tailnet :value="tailnet.address" :label="t('remote.s4_value_label')" :format="forMoonlight" copy />
            <p v-else class="banner banner--warn" data-tailnet-none>{{ t('remote.s3a_no_addr') }}</p>
            <p v-if="base !== DEFAULT_PORT" class="muted" data-port-suffix>{{ t('remote.port_suffix_note', { port: base }) }}</p>
          </template>
          <template v-else>
            <p class="muted" data-wan-note>{{ t('remote.s4_wan_note') }}</p>
            <p v-if="wanAsking" class="muted" data-wan-state="asking" role="status">{{ t('remote.s4_wan_asking') }}</p>
            <template v-else-if="wanPublic && wan">
              <p class="muted" data-wan-state="ok" role="status">{{ t('remote.s4_wan_ok') }}</p>
              <HoldReveal data-wan-address :value="wan.address" :label="t('remote.s4_wan_label')" />
              <HoldReveal data-outside-value :value="wan.address" :label="t('remote.s4_value_label')" :format="forMoonlight" copy />
            </template>
            <template v-else-if="wanNotPublic">
              <div class="banner banner--warn" data-wan-state="private" role="status">
                <p>{{ t('remote.s4_wan_private') }}</p>
                <p>{{ t('remote.s4_wan_private_help') }}</p>
                <div class="row">
                  <button class="button button--ghost" type="button" data-go-3b @click="go('3b', 'forward')">{{ t('remote.s4_go_3b') }}</button>
                  <button class="button button--ghost" type="button" data-go-3a @click="go('3a', 'tailscale')">{{ t('remote.go_3a') }}</button>
                </div>
              </div>
            </template>
            <p v-else-if="wan" class="banner banner--warn" data-wan-state="none" role="status">{{ t('remote.s4_wan_none') }}</p>
            <div class="row">
              <button class="button button--ghost" type="button" :disabled="wanAsking" data-action="wan-retry" @click="askRouter()">
                {{ t('remote.s4_retry') }}
              </button>
            </div>
            <div v-if="!wanAsking && wan && !wanPublic" class="remote__manual" data-manual>
              <h3 class="card__title">{{ t('remote.s4_manual_title') }}</h3>
              <p class="muted">{{ t('remote.s4_manual_help') }}</p>
              <template v-if="EXTERNAL_CHECK_URL">
                <p class="muted">{{ t('remote.s4_check_consent') }}</p>
                <a :href="EXTERNAL_CHECK_URL" target="_blank" rel="noopener noreferrer" data-external-check>{{ t('remote.s4_check_link') }}</a>
              </template>
              <label class="field">
                <span>{{ t('remote.s4_manual_field') }}</span>
                <input
                  v-model="manual"
                  class="input"
                  type="text"
                  inputmode="url"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  :placeholder="t('remote.s4_manual_placeholder')"
                  data-field="outside-address"
                  :aria-invalid="manualOut.error && manualOut.error !== 'empty' ? 'true' : undefined"
                  :aria-describedby="manualOut.error && manualOut.error !== 'empty' ? 'reason-outside' : undefined"
                />
              </label>
              <p v-if="manualOut.error && manualOut.error !== 'empty'" id="reason-outside" class="reason" :data-outside-error="manualOut.error">
                {{ t(`remote.s4_manual_e_${manualOut.error}`) }}
              </p>
              <HoldReveal v-if="manualOut.host" data-manual-value :value="manualOut.host" :label="t('remote.s4_value_label')" :format="forMoonlight" copy />
              <p v-if="manualOut.value && manualOut.portReplaced" class="muted" data-port-replaced>
                {{ t('remote.s4_manual_port_replaced', { port: base }) }}
              </p>
              <p class="muted" data-not-saved>{{ t('remote.s4_manual_not_saved') }}</p>
            </div>
            <p v-if="base !== DEFAULT_PORT" class="muted" data-port-suffix>{{ t('remote.port_suffix_note', { port: base }) }}</p>
            <p class="muted" data-wan-changes>{{ t('remote.s4_wan_changes') }}</p>
            <p class="muted" data-ddns>{{ t('remote.s4_ddns') }}</p>
          </template>
          <p class="muted">{{ t('remote.share_warning') }}</p>
        </li>
        <li data-s4="pin">
          <strong>{{ t('remote.s4_pin_title') }}</strong>
          <p>
            {{ t('remote.s4_pin') }}
            <RouterLink to="/devices/pair" data-pin-link>{{ t('pair.title') }}</RouterLink>
          </p>
        </li>
        <li data-s4="pairing">
          <strong>{{ t('remote.s4_pairing_title') }}</strong>
          <p class="muted">{{ t('remote.s4_pairing') }}</p>
          <p data-pairing>{{ t('remote.now_value', { value: pairingOn ? t('remote.v_enabled') : t('remote.v_disabled') }) }}</p>
          <p v-if="changes.some((c) => c.key === 'enable_pairing')" class="muted">
            {{ t('remote.before_value', { value: valueText('enable_pairing', changes.find((c) => c.key === 'enable_pairing')!.before) }) }}
          </p>
          <div class="row">
            <button
              v-if="pairingOn"
              class="button button--ghost"
              type="button"
              :disabled="!!busy || !host.online"
              data-action="pairing-off"
              @click="change('enable_pairing', 'disabled')"
            >
              {{ t('remote.pairing_off') }}
            </button>
            <button
              v-else
              class="button button--ghost"
              type="button"
              :disabled="!!busy || !host.online"
              data-action="pairing-on"
              @click="change('enable_pairing', 'enabled')"
            >
              {{ t('remote.pairing_on') }}
            </button>
          </div>
        </li>
        <li data-s4="result">
          <strong>{{ t('remote.s4_q') }}</strong>
          <div class="row">
            <button class="button button--primary" type="button" data-result="ok" :aria-pressed="progress.result === 'ok'" @click="setResult('ok')">
              {{ t('remote.s4_ok') }}
            </button>
            <button class="button button--ghost" type="button" data-result="fail" :aria-pressed="progress.result === 'fail'" @click="setResult('fail')">
              {{ t('remote.s4_fail') }}
            </button>
          </div>
          <p v-if="progress.result === 'ok'" class="banner banner--ok" data-result-ok>{{ t('remote.s4_ok_text') }}</p>
          <template v-if="progress.result === 'fail'">
            <h3 class="card__title">{{ t('remote.s4_fail_title') }}</h3>
            <ul class="list list--warn" data-causes>
              <li>{{ t('remote.f_cgnat') }}</li>
              <li>{{ t('remote.f_double') }}</li>
              <li>{{ t('remote.f_relay') }}</li>
              <li>{{ t('remote.f_firewall') }}</li>
              <li>{{ t('remote.f_isp') }}</li>
              <li>{{ t('remote.f_port', { port: base }) }}</li>
              <li data-cause-moonlight>{{ t('remote.f_moonlight') }}</li>
            </ul>
          </template>
        </li>
      </ol>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go(via === 'tailscale' ? '3a' : via === 'upnp' ? '3c' : via === 'forward' ? '3b' : '2')">
          {{ t('remote.back') }}
        </button>
        <button class="button button--primary" type="button" data-next-5 @click="go('5')">{{ t('remote.next_5') }}</button>
      </div>
    </section>

    <!-- 5 finish (H031 F4) -->
    <section v-if="step === '5'" class="card" data-remote-step="5">
      <h2 class="card__title">{{ t('remote.s5_title') }}</h2>
      <p class="banner banner--ok" data-done><strong>{{ t('remote.s5_done') }}</strong> {{ t('remote.s5_done_lead') }}</p>
      <div class="table-wrap">
        <table class="table remote__summary" data-summary>
          <tbody>
            <tr v-for="row in summary" :key="row.id" :data-summary-row="row.id">
              <th scope="row">{{ t(`remote.sum_${row.id}`) }}</th>
              <td>
                {{ t(row.text, row.params ?? {}) }}
                <p v-if="row.advice" class="muted" data-pairing-advice>
                  {{ t(row.advice) }}
                  <button class="button button--link" type="button" data-go-4 @click="go('4')">{{ t('remote.s4_pairing_title') }}</button>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="movedTo" class="banner banner--ok" data-moved>
        <p>
          {{ t('remote.new_link') }}:
          <a :href="movedTo.url" data-new-link>https://{{ MASK }}:{{ movedTo.port }}/arbs/remote</a>
        </p>
      </div>
      <details v-if="changes.length" class="details" data-advanced-revert :open="prevPortLink">
        <summary>{{ t('remote.s5_advanced') }}</summary>
        <p class="muted">{{ t('remote.s5_lead') }}</p>
        <div class="table-wrap">
          <table class="table" data-changes>
            <thead>
              <tr>
                <th scope="col">{{ t('remote.th_key') }}</th>
                <th scope="col">{{ t('remote.th_before') }}</th>
                <th scope="col">{{ t('remote.th_after') }}</th>
                <th scope="col"><span class="sr-only">{{ t('remote.revert') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in changes" :key="c.key" :data-change="c.key">
                <td>{{ t(`remote.k_${c.key}`) }}</td>
                <td>{{ valueText(c.key, c.before) }}</td>
                <td>{{ valueText(c.key, raw(c.key)) }}</td>
                <td>
                  <button
                    class="button button--ghost"
                    type="button"
                    :disabled="!!busy || !host.online || !!revertReason(c)"
                    :aria-disabled="!!revertReason(c)"
                    :aria-describedby="revertReason(c) ? `reason-revert-${c.key}` : undefined"
                    :data-revert="c.key"
                    @click="change(c.key, c.before, true)"
                  >
                    {{ t('remote.revert') }}
                  </button>
                  <ReasonText :id="`reason-revert-${c.key}`" :reason="revertReason(c)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('4')">{{ t('remote.back') }}</button>
      </div>
    </section>

    <div v-if="restartNeeded" class="banner banner--warn" data-remote-restart>
      <p>{{ t('remote.restart_needed') }}</p>
      <button class="button button--primary" type="button" :disabled="!host.online" data-action="remote-restart" @click="host.restart()">
        {{ t('remote.restart_now') }}
      </button>
    </div>
  </div>
</template>
