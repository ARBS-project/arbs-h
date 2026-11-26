<script setup lang="ts">
// ARBS-H 0.3.0 (NET2): simple line drawings for the "외부 접속" page (boxes, lines, arrows only; no photos, no logos,
// no trademarks). Colours come from the theme variables so light and dark both work.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ kind: 'overview' | 'vpn' | 'forward' }>();
const { t } = useI18n();

const label = computed(() =>
  props.kind === 'vpn' ? t('remote.d_vpn_alt') : props.kind === 'forward' ? t('remote.d_forward_alt') : t('remote.d_overview'),
);
</script>

<template>
  <svg class="diagram" viewBox="0 0 640 150" role="img" :aria-label="label" :data-diagram="kind" preserveAspectRatio="xMidYMid meet">
    <defs>
      <marker :id="`arrow-${kind}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" class="diagram__arrow" />
      </marker>
    </defs>

    <template v-if="kind === 'forward'">
      <rect x="10" y="40" width="130" height="70" rx="10" class="diagram__box" />
      <text x="75" y="70" class="diagram__text">{{ t('remote.d_away') }}</text>
      <text x="75" y="92" class="diagram__sub">{{ t('remote.d_away_sub') }}</text>
      <rect x="175" y="40" width="130" height="70" rx="35" class="diagram__cloud" />
      <text x="240" y="80" class="diagram__text">{{ t('remote.d_internet') }}</text>
      <rect x="340" y="40" width="120" height="70" rx="10" class="diagram__box diagram__box--accent" />
      <text x="400" y="70" class="diagram__text">{{ t('remote.d_router') }}</text>
      <text x="400" y="92" class="diagram__sub">TCP 3 · UDP 3</text>
      <rect x="495" y="40" width="135" height="70" rx="10" class="diagram__box" />
      <text x="562" y="70" class="diagram__text">{{ t('remote.d_home') }}</text>
      <text x="562" y="92" class="diagram__sub">{{ t('remote.d_home_sub') }}</text>
      <line x1="140" y1="75" x2="173" y2="75" class="diagram__line" :marker-end="`url(#arrow-${kind})`" />
      <line x1="305" y1="75" x2="338" y2="75" class="diagram__line" :marker-end="`url(#arrow-${kind})`" />
      <line x1="460" y1="75" x2="493" y2="75" class="diagram__line" :marker-end="`url(#arrow-${kind})`" />
    </template>

    <template v-else>
      <rect x="10" y="40" width="150" height="70" rx="10" class="diagram__box" />
      <text x="85" y="70" class="diagram__text">{{ t('remote.d_home') }}</text>
      <text x="85" y="92" class="diagram__sub">{{ t('remote.d_home_sub') }}</text>
      <rect x="245" y="40" width="150" height="70" rx="35" class="diagram__cloud" />
      <text x="320" y="80" class="diagram__text">{{ t('remote.d_internet') }}</text>
      <rect x="480" y="40" width="150" height="70" rx="10" class="diagram__box" />
      <text x="555" y="70" class="diagram__text">{{ t('remote.d_away') }}</text>
      <text x="555" y="92" class="diagram__sub">{{ t('remote.d_away_sub') }}</text>
      <template v-if="kind === 'vpn'">
        <path d="M160,62 C240,24 400,24 480,62" class="diagram__tunnel" :marker-start="`url(#arrow-${kind})`" :marker-end="`url(#arrow-${kind})`" />
        <text x="320" y="16" class="diagram__sub diagram__sub--accent">{{ t('remote.d_vpn') }}</text>
        <line x1="160" y1="90" x2="243" y2="90" class="diagram__line diagram__line--soft" />
        <line x1="395" y1="90" x2="478" y2="90" class="diagram__line diagram__line--soft" />
      </template>
      <template v-else>
        <line x1="160" y1="75" x2="243" y2="75" class="diagram__line" :marker-start="`url(#arrow-${kind})`" :marker-end="`url(#arrow-${kind})`" />
        <line x1="395" y1="75" x2="478" y2="75" class="diagram__line" :marker-start="`url(#arrow-${kind})`" :marker-end="`url(#arrow-${kind})`" />
      </template>
    </template>
  </svg>
</template>
