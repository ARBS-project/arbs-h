// ARBS-H UI1b: routes under /arbs/ (docs/analysis/UI1b.md §2-2) and the D-UI-3 address guard.
import { createRouter, createWebHistory } from 'vue-router';

import { apiGet } from '@/api/client';
import { appsFrom, appUuid } from '@/logic/apps';
import { normalizeDevice } from '@/logic/clients';
import { guardRoute } from '@/logic/guards';
import { useHostStore } from '@/stores/host';
import AccountView from '@/views/AccountView.vue';
import AppsView from '@/views/AppsView.vue';
import ControllerView from '@/views/ControllerView.vue';
import DevicesView from '@/views/DevicesView.vue';
import DisplayView from '@/views/DisplayView.vue';
import PairView from '@/views/PairView.vue';
import StatsView from '@/views/StatsView.vue';
import StatusView from '@/views/StatusView.vue';
import TroubleshootView from '@/views/TroubleshootView.vue';

const router = createRouter({
  history: createWebHistory('/arbs/'),
  routes: [
    { path: '/', name: 'status', component: StatusView, meta: { title: 'nav.status' } },
    { path: '/devices', name: 'devices', component: DevicesView, meta: { title: 'nav.devices' } },
    { path: '/devices/pair', name: 'pair', component: PairView, meta: { title: 'pair.title' } },
    { path: '/devices/:uuid', name: 'device', component: DevicesView, meta: { title: 'nav.devices' } },
    { path: '/controller', name: 'controller', component: ControllerView, meta: { title: 'nav.controller' } },
    { path: '/display', name: 'display', component: DisplayView, meta: { title: 'nav.display' } },
    { path: '/apps', name: 'apps', component: AppsView, meta: { title: 'nav.apps' } },
    { path: '/apps/new', name: 'app-new', component: AppsView, meta: { title: 'apps.add' } },
    { path: '/apps/:uuid', name: 'app', component: AppsView, meta: { title: 'nav.apps' } },
    { path: '/stats', name: 'stats', component: StatsView, meta: { title: 'nav.stats' } },
    { path: '/troubleshoot', name: 'troubleshoot', component: TroubleshootView, meta: { title: 'nav.troubleshoot' } },
    { path: '/account', name: 'account', component: AccountView, meta: { title: 'nav.account' } },
    { path: '/:pathMatch(.*)*', name: 'missing', component: StatusView },
  ],
});

async function ids(path: string): Promise<{ deviceIds: string[] | null; appIds: string[] | null }> {
  let deviceIds: string[] | null = null;
  let appIds: string[] | null = null;
  if (/^\/devices\/(?!pair$)[^/]+$/.test(path)) {
    try {
      const list = await apiGet<{ named_certs?: unknown[] }>('/api/clients/list');
      deviceIds = (list?.named_certs ?? []).map((item, i) => normalizeDevice(item, i).uuid);
    } catch {
      deviceIds = null;
    }
  }
  if (/^\/apps\/(?!new$)[^/]+$/.test(path)) {
    try {
      appIds = appsFrom(await apiGet<unknown>('/api/apps')).map(appUuid).filter(Boolean);
    } catch {
      appIds = null;
    }
  }
  return { deviceIds, appIds };
}

router.beforeEach(async (to) => {
  const host = useHostStore();
  const lists = host.signedIn ? await ids(to.path) : { deviceIds: null, appIds: null };
  const result = guardRoute({ path: to.path, signedIn: host.signedIn, ...lists });
  if (!result) return true;
  return { path: result.redirect, query: { notice: result.notice }, replace: true };
});

export default router;
