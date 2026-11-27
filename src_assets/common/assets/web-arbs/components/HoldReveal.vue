<script setup lang="ts">
// ARBS-H 0.3.1 (H031 F1): one hidden address row with "보기(누르는 동안)" (+ optional "복사"), docs/analysis/H031.md §1-2.
// Mouse, touch and pen: shown while pressed, hidden when let go. The pointer is captured on press, so the button moving
// (or the finger sliding off it) does not hide the value; only up / cancel / lost capture does. Space / Enter: shown
// while held. Long-press menu and text selection are blocked on the button. Every row keeps its own state.
// The value is never stored, logged or sent: it is only put on the screen while pressed, or copied when asked.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { MASK, type HiddenText } from '@/logic/remote';
import { nextReveal, type RevealEvent } from '@/logic/reveal';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{
  value: HiddenText | string | null;
  label: string;
  /** Turns the plain value (or ●●●) into the text to show / copy, e.g. moonlightAddress(v, base). */
  format?: (plain: string) => string;
  copy?: boolean;
}>();

const { t } = useI18n();
const ui = useUiStore();
const shown = ref(false);
const hintId = `reveal-hint-${Math.random().toString(36).slice(2, 10)}`;

function plain(): string {
  const v = props.value;
  if (v === null) return '';
  return typeof v === 'string' ? v : v.reveal();
}
const text = computed(() => {
  const base = shown.value && props.value !== null ? plain() : MASK;
  return props.format ? props.format(base) : base;
});

function apply(ev: RevealEvent): void {
  shown.value = nextReveal(shown.value, ev);
}

function onDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  } catch {
    /* capture not available: up / cancel still hide */
  }
  apply({ type: 'down', pointerType: e.pointerType, button: e.button });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') e.preventDefault();
  apply({ type: 'keydown', key: e.key, repeat: e.repeat });
}

function onKeyup(e: KeyboardEvent): void {
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') e.preventDefault();
  apply({ type: 'keyup', key: e.key });
}

function onHidden(): void {
  if (document.visibilityState === 'hidden') apply({ type: 'hidden' });
}
function onWindowBlur(): void {
  apply({ type: 'blur' });
}

onMounted(() => {
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('blur', onWindowBlur);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onHidden);
  window.removeEventListener('blur', onWindowBlur);
});

async function doCopy(): Promise<void> {
  if (props.value === null) return;
  const out = props.format ? props.format(plain()) : plain();
  try {
    await navigator.clipboard.writeText(out);
    ui.say(t('remote.copied'));
  } catch {
    ui.say(t('remote.copy_failed'), 'error');
  }
}
</script>

<template>
  <div class="remote__address">
    <span class="muted">{{ label }}</span>
    <code data-address>{{ text }}</code>
    <button
      class="button button--ghost remote__reveal"
      type="button"
      data-reveal
      :aria-pressed="shown"
      :aria-describedby="hintId"
      :disabled="value === null"
      @pointerdown="onDown"
      @pointerup="apply({ type: 'up' })"
      @pointercancel="apply({ type: 'cancel' })"
      @lostpointercapture="apply({ type: 'lost' })"
      @contextmenu.prevent
      @dragstart.prevent
      @keydown="onKeydown"
      @keyup="onKeyup"
      @blur="apply({ type: 'blur' })"
    >
      {{ t('remote.show') }}
    </button>
    <span :id="hintId" class="sr-only">{{ t('remote.show_hint') }}</span>
    <button v-if="copy" class="button button--ghost" type="button" data-copy :disabled="value === null" @click="doCopy">
      {{ t('remote.copy') }}
    </button>
  </div>
</template>
