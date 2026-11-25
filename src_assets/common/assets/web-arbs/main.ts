// ARBS-H UI1b: ARBS WebUI entry.
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { createArbsI18n } from '@/i18n';
import router from '@/router';
import { useHostStore } from '@/stores/host';
import { useUiStore } from '@/stores/ui';
import '@/styles/arbs-theme.css';
import '@/styles/base.css';

const pinia = createPinia();
const app = createApp(App).use(pinia);
useUiStore(pinia).applyTheme();
const i18n = await createArbsI18n();
await useHostStore(pinia).initialize();
app.use(i18n).use(router);

router.afterEach((route) => {
  const key = typeof route.meta.title === 'string' ? route.meta.title : 'nav.status';
  document.title = route.path === '/' ? 'ARBS-H' : `${i18n.global.t(key)} · ARBS-H`;
});

app.mount('#app');
