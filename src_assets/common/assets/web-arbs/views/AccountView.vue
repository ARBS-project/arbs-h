<script setup lang="ts">
// ARBS-H UI1b card U "계정·화면 모양": H-NAV-08, H-V2NAV-07 (logout), H-NAV-11, H-V2NAV-05 (theme),
// H-V2MNT-07 (password), plus the new default UI choice (arbs_webui_default).
// Sign-in / first account (H-NAV-12, H-AUTH-01/02, H-V2AUTH-01/02) are in LoginOverlay.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError, apiPost } from '@/api/client';
import ReasonText from '@/components/ReasonText.vue';
import { WEBUI_DEFAULTS, type WebUiDefault } from '@/logic/config';
import { firstReason, offlineReason, passwordReason } from '@/logic/rules';
import type { ThemePreference } from '@/logic/theme';
import { useHostStore } from '@/stores/host';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';

const { t } = useI18n();
const host = useHostStore();
const settings = useSettingsStore();
const ui = useUiStore();
const themes: ThemePreference[] = ['light', 'dark', 'system'];

const form = ref({ currentUsername: '', currentPassword: '', newUsername: '', newPassword: '', confirmPassword: '' });
const busy = ref(false);
const reason = computed(() => firstReason(offlineReason(host.online), passwordReason(form.value)));

async function changePassword(): Promise<void> {
  if (reason.value) return;
  busy.value = true;
  try {
    const result = await apiPost<{ status?: boolean; error?: string }>('/api/password', {
      currentUsername: form.value.currentUsername,
      currentPassword: form.value.currentPassword,
      newUsername: form.value.newUsername.trim(),
      newPassword: form.value.newPassword,
      confirmNewPassword: form.value.confirmPassword,
    });
    if (result?.status === false) throw new Error('rejected');
    ui.say(t('account.password_saved'));
    form.value = { currentUsername: '', currentPassword: '', newUsername: '', newPassword: '', confirmPassword: '' };
    await host.fetchAuth();
  } catch (cause) {
    ui.say(cause instanceof ApiError && cause.status === 401 ? t('auth.wrong') : t('account.password_failed'), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('nav.account') }}</h1>
      <p class="muted">{{ t('account.lead') }}</p>
    </header>

    <div class="grid">
      <section class="card" data-card="U">
        <h2 class="card__title">{{ t('account.default_ui') }}</h2>
        <p class="muted">{{ t('account.default_ui_help') }}</p>
        <fieldset class="fieldset" data-setting="arbs_webui_default">
          <legend class="sr-only">{{ t('account.default_ui') }}</legend>
          <label v-for="v in WEBUI_DEFAULTS" :key="v" class="check">
            <input
              type="radio"
              name="arbs-webui-default"
              :value="v"
              :checked="settings.draft.arbs_webui_default === v"
              @change="settings.set('arbs_webui_default', v as WebUiDefault)"
            />
            <span>{{ t(`account.default_${v}`) }}</span>
          </label>
        </fieldset>
        <small class="muted">{{ t('account.default_ui_note') }}</small>
      </section>

      <section class="card" data-card="U" data-feature="H-NAV-11" data-feature-2="H-V2NAV-05">
        <h2 class="card__title">{{ t('theme.label') }}</h2>
        <div class="segmented" role="group" :aria-label="t('theme.label')">
          <button
            v-for="value in themes"
            :key="value"
            type="button"
            class="segmented__item"
            :aria-pressed="ui.theme === value"
            @click="ui.setTheme(value)"
          >
            {{ t(`theme.${value}`) }}
          </button>
        </div>
        <small class="muted">{{ t('theme.help') }}</small>
      </section>

      <section class="card" data-card="U" data-feature="H-V2MNT-07">
        <h2 class="card__title">{{ t('account.password') }}</h2>
        <label class="field">
          <span>{{ t('account.current_username') }}</span>
          <input v-model="form.currentUsername" class="input" autocomplete="username" />
        </label>
        <label class="field">
          <span>{{ t('account.current_password') }}</span>
          <input v-model="form.currentPassword" class="input" type="password" autocomplete="current-password" />
        </label>
        <label class="field">
          <span>{{ t('account.new_username') }}</span>
          <input v-model="form.newUsername" class="input" autocomplete="username" />
        </label>
        <label class="field">
          <span>{{ t('account.new_password') }}</span>
          <input v-model="form.newPassword" class="input" type="password" autocomplete="new-password" />
        </label>
        <label class="field">
          <span>{{ t('account.confirm_password') }}</span>
          <input v-model="form.confirmPassword" class="input" type="password" autocomplete="new-password" />
        </label>
        <button
          class="button button--primary"
          type="button"
          :disabled="busy || !!reason"
          :aria-disabled="!!reason"
          :aria-describedby="reason ? 'reason-password' : undefined"
          data-action="password"
          @click="changePassword()"
        >
          {{ t('account.change_password') }}
        </button>
        <ReasonText id="reason-password" :reason="reason" />
      </section>

      <section class="card" data-card="U" data-feature="H-NAV-08" data-feature-2="H-V2NAV-07">
        <h2 class="card__title">{{ t('account.session') }}</h2>
        <p class="muted">{{ t('account.logout_help') }}</p>
        <button class="button button--ghost" type="button" data-action="logout" @click="host.logout()">
          {{ t('account.logout') }}
        </button>
      </section>
    </div>
  </div>
</template>
