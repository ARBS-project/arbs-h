// ARBS-H UI1b: ARBS WebUI (served at /arbs/). Same stack as the v2 web UI (../web), no UI library.
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const configuredOutputDirectory = process.env.SUNSHINE_ARBS_WEB_OUTPUT_DIR;

export default defineConfig({
  plugins: [vue()],
  base: '/arbs/',
  resolve: {
    dedupe: ['vue', 'vue-i18n'],
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  build: {
    // Build after the legacy UI: its build empties build/assets/web (emptyOutDir).
    outDir: configuredOutputDirectory
      ? resolve(configuredOutputDirectory)
      : fileURLToPath(new URL('../../../../build/assets/web/arbs', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    proxy: {
      '/api': { target: 'https://127.0.0.1:47990', changeOrigin: true, secure: false },
      '/images': { target: 'https://127.0.0.1:47990', changeOrigin: true, secure: false },
    },
  },
});
