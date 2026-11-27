<script setup lang="ts">
// ARBS-H UI1b: sign-in cover (H-NAV-12, H-AUTH-01, H-V2AUTH-01) and first administrator
// account (H-AUTH-02, H-V2AUTH-02). Same server APIs as the other UIs.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '@/api/client';
import { passwordReason } from '@/logic/rules';
import { useHostStore } from '@/stores/host';

// 0.3.1 (H031): ARBS logo above the title (served from /arbs/images/, not bundled, so it is bound instead of imported).
const logo = '/arbs/images/arbs-logo.svg';
const { t } = useI18n();
const host = useHostStore();
const username = ref('');
const password = ref('');
const confirm = ref('');
const remember = ref(true);
const busy = ref(false);
const error = ref('');

const setup = computed(() => host.needsSetup);
const reason = computed(() =>
  setup.value
    ? passwordReason({ newUsername: username.value, newPassword: password.value, confirmPassword: confirm.value })
    : username.value.trim() && password.value
      ? null
      : 'reason.need_login_fields',
);

async function submit(): Promise<void> {
  if (reason.value) return;
  error.value = '';
  busy.value = true;
  try {
    if (setup.value) await host.createAccount(username.value.trim(), password.value, confirm.value);
    else await host.login(username.value.trim(), password.value, remember.value);
    password.value = '';
    confirm.value = '';
  } catch (cause) {
    error.value =
      cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
        ? t('auth.wrong')
        : t(setup.value ? 'auth.create_failed' : 'auth.failed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="login-title" data-feature="H-NAV-12">
    <form class="overlay__panel card" novalidate @submit.prevent="submit">
      <img class="overlay__logo" :src="logo" alt="" width="40" height="40" data-login-logo />
      <template v-if="setup">
        <h2 id="login-title" class="card__title" data-feature="H-AUTH-02" data-feature-2="H-V2AUTH-02">
          {{ t('auth.create_title') }}
        </h2>
        <p class="muted">{{ t('auth.create_help') }}</p>
      </template>
      <template v-else>
        <h2 id="login-title" class="card__title" data-feature="H-AUTH-01" data-feature-2="H-V2AUTH-01">
          {{ t('auth.login_title') }}
        </h2>
        <p class="muted">{{ t('auth.login_help') }}</p>
      </template>
      <label class="field">
        <span>{{ t('auth.username') }}</span>
        <input v-model="username" class="input" autocomplete="username" />
      </label>
      <label class="field">
        <span>{{ t('auth.password') }}</span>
        <input
          v-model="password"
          class="input"
          type="password"
          :autocomplete="setup ? 'new-password' : 'current-password'"
        />
      </label>
      <label v-if="setup" class="field">
        <span>{{ t('auth.confirm') }}</span>
        <input v-model="confirm" class="input" type="password" autocomplete="new-password" />
      </label>
      <label v-else class="check">
        <input v-model="remember" type="checkbox" />
        <span>{{ t('auth.remember') }}</span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button
        class="button button--primary"
        type="submit"
        :disabled="busy || !!reason"
        :aria-disabled="!!reason"
        :aria-describedby="reason ? 'reason-login' : undefined"
      >
        {{ setup ? t('auth.create') : t('auth.login') }}
      </button>
      <p v-if="reason" id="reason-login" class="reason">{{ t(reason) }}</p>
    </form>
  </div>
</template>
