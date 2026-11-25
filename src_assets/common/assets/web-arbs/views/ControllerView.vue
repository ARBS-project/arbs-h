<script setup lang="ts">
// ARBS-H UI1b card C "ARBS 컨트롤러": H-SET-065/067/069/071/203/204/205.
// First input fields for arbs_trigger_status and arbs_enet_precise_time (PATCH /api/config).
// D-UI-3 R6 (gamepad input off) and R7 (gamepad is not usbip_ds5).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import ReasonText from '@/components/ReasonText.vue';
import { clampGain, GAMEPAD_TYPES, TRIGGER_STATUS, type TriggerStatus } from '@/logic/config';
import { controllerOffReason, dualSenseReason, gamepadWarning } from '@/logic/rules';
import { useSettingsStore } from '@/stores/settings';

const { t } = useI18n();
const settings = useSettingsStore();
const draft = computed(() => settings.draft);

const offReason = computed(() => controllerOffReason(draft.value));
const dsReason = computed(() => dualSenseReason(draft.value));
const warn = computed(() => gamepadWarning(draft.value));
const triggerChanged = computed(() => settings.changed.includes('arbs_trigger_status'));
const preciseChanged = computed(() => settings.changed.includes('arbs_enet_precise_time'));

function setGain(event: Event): void {
  settings.set('dualsense_haptics_gain', clampGain((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.controller') }}</h1>
      <p class="muted">{{ t('controller.lead') }}</p>
    </header>
    <p v-if="!settings.loaded" class="muted">{{ t('common.loading') }}</p>

    <div class="grid">
      <section class="card" data-card="C">
        <h2 class="card__title">{{ t('controller.basic') }}</h2>

        <label class="switch" data-feature="H-SET-065">
          <input
            type="checkbox"
            role="switch"
            :checked="draft.controller"
            data-setting="controller"
            @change="settings.set('controller', ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ t('controller.input') }}</strong>
            <small class="muted">{{ t('controller.input_help') }}</small>
          </span>
        </label>

        <label class="field" data-feature="H-SET-069">
          <span>{{ t('controller.gamepad') }}</span>
          <select
            class="input"
            :value="draft.gamepad"
            :disabled="!!offReason"
            :aria-describedby="offReason ? 'reason-off-gamepad' : warn ? 'warn-gamepad' : undefined"
            data-setting="gamepad"
            @change="settings.set('gamepad', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="g in GAMEPAD_TYPES" :key="g" :value="g" :data-feature="g === 'usbip_ds5' ? 'H-SET-205' : undefined">
              {{ t(`gamepad.${g}`) }}
            </option>
          </select>
        </label>
        <ReasonText id="reason-off-gamepad" :reason="offReason" />
        <p v-if="warn" id="warn-gamepad" class="banner banner--warn" role="alert" data-gamepad-warning>
          {{ t('controller.gamepad_warning') }}
        </p>

        <label class="switch" data-feature="H-SET-067">
          <input
            type="checkbox"
            role="switch"
            :checked="draft.forward_rumble"
            :disabled="!!offReason"
            :aria-describedby="offReason ? 'reason-off-gamepad' : undefined"
            data-setting="forward_rumble"
            @change="settings.set('forward_rumble', ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ t('controller.rumble') }}</strong>
            <small class="muted">{{ t('controller.rumble_help') }}</small>
          </span>
        </label>
      </section>

      <section class="card" data-card="C">
        <h2 class="card__title">{{ t('controller.dualsense') }}</h2>
        <ReasonText id="reason-ds" :reason="dsReason" />

        <label class="field" data-feature="H-SET-204">
          <span>{{ t('controller.trigger') }}</span>
          <select
            class="input"
            :value="draft.arbs_trigger_status"
            :disabled="!!dsReason"
            :aria-describedby="dsReason ? 'reason-ds' : 'help-trigger'"
            data-setting="arbs_trigger_status"
            @change="settings.set('arbs_trigger_status', ($event.target as HTMLSelectElement).value as TriggerStatus)"
          >
            <option v-for="v in TRIGGER_STATUS" :key="v" :value="v">{{ t(`controller.trigger_${v}`) }}</option>
          </select>
          <small id="help-trigger" class="muted">{{ t('controller.trigger_help') }}</small>
        </label>
        <p v-if="triggerChanged" class="banner banner--info" role="status" data-restart-hint>
          {{ t('controller.trigger_restart') }}
        </p>

        <label class="field" data-feature="H-SET-071">
          <span>{{ t('controller.gain') }}: <strong>{{ draft.dualsense_haptics_gain.toFixed(1) }}</strong></span>
          <input
            type="range"
            min="0"
            max="4"
            step="0.1"
            :value="draft.dualsense_haptics_gain"
            :disabled="!!dsReason"
            :aria-describedby="dsReason ? 'reason-ds' : 'help-gain'"
            data-setting="dualsense_haptics_gain"
            @input="setGain"
          />
          <small id="help-gain" class="muted">{{ t('controller.gain_help') }}</small>
        </label>

        <p class="muted" data-feature="H-APP-22">
          {{ t('controller.per_app') }}
          <RouterLink to="/apps">{{ t('controller.per_app_link') }}</RouterLink>
        </p>

        <details class="details" data-advanced>
          <summary>{{ t('controller.advanced') }}</summary>
          <label class="switch" data-feature="H-SET-203">
            <input
              type="checkbox"
              role="switch"
              :checked="draft.arbs_enet_precise_time"
              data-setting="arbs_enet_precise_time"
              @change="settings.set('arbs_enet_precise_time', ($event.target as HTMLInputElement).checked)"
            />
            <span>
              <strong>{{ t('controller.precise') }}</strong>
              <small class="muted">{{ t('controller.precise_help') }}</small>
            </span>
          </label>
          <p v-if="preciseChanged" class="banner banner--info" role="status">{{ t('controller.precise_restart') }}</p>
        </details>
      </section>
    </div>
  </div>
</template>
