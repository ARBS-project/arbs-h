<script setup lang="ts">
// ARBS-H UI1b: one-line reason under a disabled control (D-UI-3). Uses the normal muted
// text colour (AA), not the disabled grey. Link the control with aria-describedby="id".
import { useI18n } from 'vue-i18n';

defineProps<{ id: string; reason: string | null }>();
const { t } = useI18n();
</script>

<template>
  <p v-if="reason" :id="id" class="reason" data-reason>{{ t(reason) }}</p>
</template>
