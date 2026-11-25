// ARBS-H UI1b: sign-in state, connection heartbeat, host metadata and session status.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { apiGet, apiPost, clearCsrfToken } from '@/api/client';

export interface AuthStatus {
  authenticated: boolean;
  credentials_configured: boolean;
  login_required: boolean;
}

export interface SessionStatus {
  activeSessions?: number;
  appRunning?: boolean;
  appName?: string;
  paused?: boolean;
  lastEncoderProbeFailed?: boolean;
}

export type HostMetadata = Record<string, unknown> & {
  version?: string;
  platform?: string;
  architecture?: string;
  branch?: string;
  commit?: string;
  release_date?: string;
  encoder_status?: { state?: string };
  virtual_display_driver?: { configured?: string; active?: string | null; status?: string; status_code?: number };
};

const HEARTBEAT_MS = 5000;

export const useHostStore = defineStore('host', () => {
  const auth = ref<AuthStatus>({ authenticated: false, credentials_configured: true, login_required: true });
  const authLoaded = ref(false);
  const online = ref(true);
  const restarting = ref(false);
  const metadata = ref<HostMetadata | null>(null);
  const session = ref<SessionStatus | null>(null);
  const hostError = ref(false);
  const loadingHost = ref(false);
  const lastUpdated = ref<number | null>(null);
  let failures = 0;
  let timer: number | undefined;

  const needsSetup = computed(() => !auth.value.credentials_configured);
  const needsLogin = computed(() => auth.value.credentials_configured && auth.value.login_required);
  const signedIn = computed(() => authLoaded.value && !needsSetup.value && !needsLogin.value);
  const streaming = computed(() =>
    Boolean(session.value?.appRunning || (session.value?.activeSessions ?? 0) > 0),
  );

  async function fetchAuth(): Promise<AuthStatus> {
    const result = await apiGet<AuthStatus>('/api/auth/status');
    auth.value = result;
    authLoaded.value = true;
    return result;
  }

  async function refreshHost(): Promise<void> {
    if (!signedIn.value || loadingHost.value) return;
    loadingHost.value = true;
    try {
      const [meta, status] = await Promise.allSettled([
        apiGet<HostMetadata>('/api/metadata', { signal: AbortSignal.timeout(8000) }),
        apiGet<SessionStatus>('/api/session/status', { signal: AbortSignal.timeout(5000) }),
      ]);
      if (meta.status === 'fulfilled') metadata.value = meta.value;
      if (status.status === 'fulfilled') session.value = status.value;
      hostError.value = meta.status === 'rejected' || status.status === 'rejected';
      lastUpdated.value = Date.now();
    } finally {
      loadingHost.value = false;
    }
  }

  async function beat(): Promise<void> {
    try {
      const response = await fetch('/api/configLocale', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok && response.status >= 500) throw new Error('heartbeat');
      failures = 0;
      if (!online.value || restarting.value) {
        online.value = true;
        restarting.value = false;
        clearCsrfToken();
        await fetchAuth().catch(() => undefined);
        void refreshHost();
      }
    } catch {
      failures += 1;
      if (failures >= 2) online.value = false;
    }
  }

  function startHeartbeat(): void {
    window.clearInterval(timer);
    timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
  }

  async function initialize(): Promise<void> {
    try {
      await fetchAuth();
      online.value = true;
    } catch {
      online.value = false;
    }
    startHeartbeat();
    void refreshHost();
  }

  async function login(username: string, password: string, rememberMe: boolean): Promise<void> {
    await apiPost('/api/auth/login', { username, password, remember_me: rememberMe });
    clearCsrfToken();
    await fetchAuth();
    void refreshHost();
  }

  async function createAccount(username: string, password: string, confirm: string): Promise<void> {
    await apiPost('/api/password', {
      currentUsername: '',
      currentPassword: '',
      newUsername: username,
      newPassword: password,
      confirmNewPassword: confirm,
    });
    clearCsrfToken();
    const status = await fetchAuth();
    if (status.login_required) await login(username, password, false);
  }

  async function logout(): Promise<void> {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      clearCsrfToken();
      metadata.value = null;
      session.value = null;
      await fetchAuth().catch(() => undefined);
    }
  }

  /** POST /api/restart. The server goes away; the heartbeat brings the page back. */
  async function restart(): Promise<void> {
    restarting.value = true;
    try {
      await apiPost('/api/restart', {});
    } catch {
      /* the connection usually drops before a reply */
    }
    online.value = false;
    failures = 2;
  }

  return {
    auth,
    authLoaded,
    online,
    restarting,
    metadata,
    session,
    hostError,
    loadingHost,
    lastUpdated,
    needsSetup,
    needsLogin,
    signedIn,
    streaming,
    fetchAuth,
    refreshHost,
    initialize,
    login,
    createAccount,
    logout,
    restart,
    beat,
  };
});
