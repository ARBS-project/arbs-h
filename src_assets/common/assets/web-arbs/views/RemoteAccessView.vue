<script setup lang="ts">
// ARBS-H 0.3.0 (NET2): "외부 접속" wizard, docs/analysis/NET2.md §3 (steps 0..5; 3a Tailscale, 3b port forwarding,
// 3c UPnP, 3d port change). Only the WIZARD_KEYS are PATCHed, the value before is shown next to every change and step 5
// puts it back. Addresses are hidden (●●●) and shown only while "보기" is held: never stored, logged or sent.
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { apiGet, apiPatch } from '@/api/client';
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
  EXTERNAL_CHECK_URL,
  hostKind,
  MASK,
  moonlightAddress,
  neverOpen,
  newWebUiUrl,
  originOf,
  overlapsSunshineDefault,
  parsePrevPort,
  parseStep,
  readChanges,
  readDiagnostics,
  recommend,
  recordChange,
  restoreBlockReason,
  ROUTER_GUIDE_LINKS,
  serverBool,
  shown,
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
  type Step,
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
const revealed = ref(false);
const restartNeeded = ref(false);
const movedTo = ref<{ url: string; port: number } | null>(null);
const routerAnswer = ref<Answer>('unknown');
const wanAnswer = ref<Answer>('unknown');
const result = ref<'' | 'ok' | 'fail'>('');
const newPort = ref(String(ARBS_PORT));

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const changes = ref<Change[]>(readChanges(storage()?.getItem(CHANGES_KEY) ?? null));
watch(changes, (list) => storage()?.setItem(CHANGES_KEY, JSON.stringify(list)), { deep: true });

const step = computed<Step>(() => parseStep(route.query.step));
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
const wanEnc = computed(() => raw('wan_encryption_mode') || '1');
const upnpReason = computed(() => upnpBlockReason(originWan.value));
const tailnet = computed(() => {
  const all = diag.value?.interfaces ?? [];
  return all.find((i) => i.tailscaleLike && i.kind === 'cgnat_v4') ?? all.find((i) => i.kind === 'cgnat_v4') ?? all.find((i) => i.tailscaleLike) ?? null;
});
const local = computed(() => diag.value?.interfaces.find((i) => i.kind === 'private_v4') ?? null);
const portCheck = computed(() => checkPort(newPort.value, base.value));
const preview = computed(() => (portCheck.value.error === null && portCheck.value.port !== null ? streamPorts(portCheck.value.port) : null));
const guides = computed(() => ROUTER_GUIDE_LINKS.map((g) => ({ ...g, label: t(`remote.g_${g.id}`) })));

function raw(key: WizardKey): string {
  const value = config.value[key];
  return value === undefined || value === null ? '' : String(value);
}

/** S3 on step 5: "이전 값으로" that would give UPnP on + origin = wan is disabled with this reason. */
function revertReason(c: Change): string | null {
  return restoreBlockReason(c.key, c.before, config.value, diag.value?.originWan ?? false);
}

function valueText(key: WizardKey, value: string): string {
  if (value === '') return t('remote.v_none');
  if (key === 'upnp' || key === 'enable_pairing') return serverBool(value, false) ? t('remote.v_enabled') : t('remote.v_disabled');
  return value;
}

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

function go(next: Step): void {
  void router.replace({ path: '/remote', query: { ...route.query, step: next } });
  window.scrollTo(0, 0);
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

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ui.say(t('remote.copied'));
  } catch {
    ui.say(t('remote.copy_failed'), 'error');
  }
}

function hold(on: boolean): void {
  revealed.value = on;
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
          <button class="button button--primary" type="button" @click="go('3a')">{{ t('remote.go_3a') }}</button>
        </div>
        <div class="card remote__method" data-method="forward">
          <h3 class="card__title">{{ t('remote.m_forward') }}</h3>
          <p class="muted">{{ t('remote.m_forward_text') }}</p>
          <button class="button button--ghost" type="button" @click="go('3b')">{{ t('remote.go_3b') }}</button>
        </div>
        <div class="card remote__method" data-method="upnp">
          <h3 class="card__title">{{ t('remote.m_upnp') }}</h3>
          <p class="muted">{{ t('remote.m_upnp_text') }}</p>
          <button class="button button--ghost" type="button" @click="go('3c')">{{ t('remote.go_3c') }}</button>
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
          <div v-if="tailnet" class="remote__address" data-tailnet>
            <span class="muted">{{ t('remote.addr_label') }}</span>
            <code data-address>{{ moonlightAddress(revealed ? tailnet.address.reveal() : MASK, base) }}</code>
            <button
              class="button button--ghost"
              type="button"
              data-reveal
              @pointerdown="hold(true)"
              @pointerup="hold(false)"
              @pointerleave="hold(false)"
              @pointercancel="hold(false)"
              @keydown.enter.space.prevent="hold(true)"
              @keyup="hold(false)"
              @blur="hold(false)"
            >
              {{ t('remote.show') }}
            </button>
            <button class="button button--ghost" type="button" data-copy @click="copy(moonlightAddress(tailnet.address.reveal(), base))">
              {{ t('remote.copy') }}
            </button>
          </div>
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
      <p data-lan-enc>{{ t('remote.now_value', { value: lanEnc }) }}</p>
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
        <button class="button button--primary" type="button" @click="go('4')">{{ t('remote.next') }}</button>
      </div>
    </section>

    <!-- 3b port forwarding -->
    <section v-if="step === '3b'" class="card" data-remote-step="3b">
      <h2 class="card__title">{{ t('remote.s3b_title') }}</h2>
      <RemoteDiagram kind="forward" />
      <ol class="steps">
        <li>
          {{ t('remote.s3b_1') }}
          <div v-if="local" class="remote__address" data-local>
            <span class="muted">{{ t('remote.s3b_local') }}</span>
            <code data-address>{{ shown(local.address, revealed) }}</code>
            <button
              class="button button--ghost"
              type="button"
              data-reveal
              @pointerdown="hold(true)"
              @pointerup="hold(false)"
              @pointerleave="hold(false)"
              @pointercancel="hold(false)"
              @keydown.enter.space.prevent="hold(true)"
              @keyup="hold(false)"
              @blur="hold(false)"
            >
              {{ t('remote.show') }}
            </button>
          </div>
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
        <li>{{ t('remote.s3b_3') }}</li>
        <li>{{ base === DEFAULT_PORT ? t('remote.s3b_addr_default') : t('remote.s3b_addr_port', { port: base }) }}</li>
      </ol>
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
      <div class="divider"></div>
      <h3 class="card__title">{{ t('remote.s3b_pairing_title') }}</h3>
      <p class="muted">{{ t('remote.s3b_pairing') }}</p>
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
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" @click="go('4')">{{ t('remote.next') }}</button>
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
        <button class="button button--primary" type="button" @click="go('4')">{{ t('remote.next') }}</button>
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
        <button class="button button--primary" type="button" @click="go('4')">{{ t('remote.next') }}</button>
      </div>
    </section>

    <!-- 4 try -->
    <section v-if="step === '4'" class="card" data-remote-step="4">
      <h2 class="card__title">{{ t('remote.s4_title') }}</h2>
      <p>{{ t('remote.s4_1') }}</p>
      <p>{{ t('remote.s4_q') }}</p>
      <div class="row">
        <button class="button button--primary" type="button" data-result="ok" :aria-pressed="result === 'ok'" @click="result = 'ok'">
          {{ t('remote.s4_ok') }}
        </button>
        <button class="button button--ghost" type="button" data-result="fail" :aria-pressed="result === 'fail'" @click="result = 'fail'">
          {{ t('remote.s4_fail') }}
        </button>
      </div>
      <p v-if="result === 'ok'" class="banner banner--ok" data-result-ok>{{ t('remote.s4_ok_text') }}</p>
      <template v-if="result === 'fail'">
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
      <template v-if="EXTERNAL_CHECK_URL">
        <h3 class="card__title">{{ t('remote.s4_check_title') }}</h3>
        <p class="muted">{{ t('remote.s4_check_consent') }}</p>
        <a :href="EXTERNAL_CHECK_URL" target="_blank" rel="noopener noreferrer" data-external-check>{{ t('remote.s4_check_link') }}</a>
      </template>
      <div class="row">
        <button class="button button--ghost" type="button" @click="go('2')">{{ t('remote.back') }}</button>
        <button class="button button--primary" type="button" @click="go('5')">{{ t('remote.next') }}</button>
      </div>
    </section>

    <!-- 5 undo -->
    <section v-if="step === '5'" class="card" data-remote-step="5">
      <h2 class="card__title">{{ t('remote.s5_title') }}</h2>
      <p class="muted">{{ t('remote.s5_lead') }}</p>
      <p v-if="!changes.length" class="muted" data-changes-none>{{ t('remote.s5_none') }}</p>
      <div v-else class="table-wrap">
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
      <p class="muted" data-wan-enc>{{ t('remote.s5_wan_enc', { value: wanEnc }) }}</p>
      <div v-if="movedTo" class="banner banner--ok" data-moved>
        <p>
          {{ t('remote.new_link') }}:
          <a :href="movedTo.url" data-new-link>https://{{ MASK }}:{{ movedTo.port }}/arbs/remote</a>
        </p>
      </div>
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
