// ARBS-H UI1b: the settings edited in this UI. One explicit "save" (H-SET-208/209):
// PATCH /api/config with the changed keys only.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { apiGet, apiPatch } from '@/api/client';
import {
  changedKeys,
  DEFAULTS,
  needsRestart,
  patchBody,
  readSettings,
  saveStateAfter,
  type ArbsSettings,
  type PatchResult,
  type SaveState,
  type SettingKey,
} from '@/logic/config';

export const useSettingsStore = defineStore('settings', () => {
  const raw = ref<Record<string, unknown>>({});
  const original = ref<ArbsSettings>({ ...DEFAULTS });
  const draft = ref<ArbsSettings>({ ...DEFAULTS });
  const loaded = ref(false);
  const loading = ref(false);
  const state = ref<SaveState>('idle');
  const restartPending = ref(false);
  const error = ref('');

  const changed = computed(() => changedKeys(original.value, draft.value));
  const dirty = computed(() => changed.value.length > 0);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const config = await apiGet<Record<string, unknown>>('/api/config');
      raw.value = config ?? {};
      original.value = readSettings(raw.value);
      draft.value = { ...original.value };
      loaded.value = true;
    } catch {
      error.value = 'save.load_failed';
    } finally {
      loading.value = false;
    }
  }

  function discard(): void {
    draft.value = { ...original.value };
    if (state.value === 'error') state.value = 'idle';
  }

  function set<K extends SettingKey>(key: K, value: ArbsSettings[K]): void {
    draft.value = { ...draft.value, [key]: value };
    if (state.value === 'saved' || state.value === 'error') state.value = 'idle';
  }

  async function save(only?: SettingKey[]): Promise<SaveState> {
    const body = patchBody(original.value, draft.value, only);
    const keys = Object.keys(body) as SettingKey[];
    if (!keys.length) return state.value;
    state.value = 'saving';
    error.value = '';
    try {
      const result = await apiPatch<PatchResult>('/api/config', body);
      const next = saveStateAfter(result ?? {}, keys);
      if (next !== 'error') {
        const merged = { ...original.value };
        for (const key of keys) (merged as Record<string, unknown>)[key] = draft.value[key];
        original.value = merged;
        if (next === 'restart' || needsRestart(keys)) restartPending.value = true;
      }
      state.value = next;
      return next;
    } catch {
      state.value = 'error';
      error.value = 'save.failed';
      return 'error';
    }
  }

  return { raw, original, draft, loaded, loading, state, restartPending, error, changed, dirty, load, discard, set, save };
});
