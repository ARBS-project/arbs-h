<script setup lang="ts">
// ARBS-H UI1b: origin and third-party notice (H-V2OV-10) and links (H-HOME-17).
import { useI18n } from 'vue-i18n';

import { ARBS_UPSTREAM_BASE, ISSUES_NEW_PAGE, PRODUCT_NAME, RELEASES_PAGE, REPO_PAGE } from '@/utils/repo';

const { t } = useI18n();
const UPSTREAM = 'https://github.com/Nonary/Vibepollo';
const arbsNotice = `${REPO_PAGE}/blob/main/NOTICE-ARBS.md`;
const thirdParty = `${REPO_PAGE}/blob/main/NOTICE`;
const license = `${REPO_PAGE}/blob/main/LICENSE`;
</script>

<template>
  <footer class="footer">
    <p class="footer__base" data-feature="H-V2OV-10">
      <strong>{{ PRODUCT_NAME }}</strong> · {{ ARBS_UPSTREAM_BASE }}
    </p>
    <p class="muted">{{ t('footer.third_party') }}</p>
    <nav class="footer__links" :aria-label="t('footer.links')" data-feature="H-HOME-17">
      <a :href="REPO_PAGE" target="_blank" rel="noopener noreferrer">{{ t('footer.source') }}</a>
      <a :href="RELEASES_PAGE" target="_blank" rel="noopener noreferrer">{{ t('footer.releases') }}</a>
      <a :href="ISSUES_NEW_PAGE" target="_blank" rel="noopener noreferrer">{{ t('footer.report') }}</a>
      <a :href="UPSTREAM" target="_blank" rel="noopener noreferrer">{{ t('footer.upstream') }}</a>
      <a :href="arbsNotice" target="_blank" rel="noopener noreferrer">{{ t('footer.notice') }}</a>
      <a :href="thirdParty" target="_blank" rel="noopener noreferrer">{{ t('footer.third_party_link') }}</a>
      <a :href="license" target="_blank" rel="noopener noreferrer">GPL-3.0</a>
    </nav>
  </footer>
</template>
