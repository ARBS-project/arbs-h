// ARBS-H UI1b: small mock of the ARBS-H web API for screenshots and manual checks.
// Serves a built ARBS WebUI (vite build output) at /arbs/ and fake /api/* answers.
// Local only (127.0.0.1). Not shipped: scripts/ is not part of the build.
// Usage: node scripts/mock-server.mjs --dist <build dir> [--port 5180] [--images <dir>]
// Control: POST /__mock/state {json} merges into the state (auth, config, offline, ...).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(args.dist ?? join(here, '../../../../../build/assets/web/arbs'));
const images = resolve(args.images ?? join(here, '../../web/public/images'));
const port = Number(args.port ?? 5180);

const initial = () => ({
  offline: false,
  auth: { authenticated: true, credentials_configured: true, login_required: false },
  config: {
    controller: 'enabled',
    forward_rumble: 'enabled',
    gamepad: 'usbip_ds5',
    dualsense_haptics_gain: '1.0',
    virtual_display_mode: 'per_client',
    dd_resolution_option: 'auto',
    notify_pre_releases: 'disabled',
  },
  session: { activeSessions: 1, appRunning: true, appName: 'Desktop', paused: false, lastEncoderProbeFailed: false, status: true },
  golden: { exists: false },
  devices: [
    {
      uuid: '11111111-2222-3333-4444-555555555555',
      name: 'Odin 2 Portal',
      connected: true,
      enabled: true,
      allow_sleep: false,
      perm: 0x07001f00,
      last_seen: 1764000000,
      display_mode: '',
      virtual_display_mode: '',
      do: [],
      undo: [],
    },
    { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Office laptop', connected: false, enabled: true, perm: 0x03000000, last_seen: 1763000000 },
    { uuid: '99999999-8888-7777-6666-555555555555', name: 'Old tablet', connected: false, enabled: false, perm: 0, last_seen: null },
  ],
  apps: [
    { uuid: 'aaaa1111-0000-4000-8000-000000000001', name: 'Desktop', cmd: '', 'image-path': 'desktop.png', 'dualsense-haptics': false },
    { uuid: 'aaaa1111-0000-4000-8000-000000000002', name: 'Elden Ring', cmd: 'steam://rungameid/1245620', 'steam-id': '1245620', 'dualsense-haptics': true },
    { uuid: 'aaaa1111-0000-4000-8000-000000000003', name: 'Astro Bot', cmd: 'C:\\Games\\Astro\\astro.exe', 'playnite-id': 'p1', 'playnite-managed': 'auto', 'dualsense-haptics': true },
  ],
});
let state = initial();

const LOG = [
  '[2026-11-25 10:00:00.001]: Info: ARBS-H 0.2.0 (based on Vibepollo 2.18.9)',
  '[2026-11-25 10:00:00.120]: Info: Gamepad: usbip_ds5 (DualSense)',
  '[2026-11-25 10:00:01.500]: Warning: Display helper: snapshot missing',
  '[2026-11-25 10:00:02.010]: Info: Configuration UI available at [https://localhost:47990]',
  '[2026-11-25 10:01:10.400]: Error: Example error line for the log viewer',
  '[2026-11-25 10:01:11.000]: Debug: haptics frame 480 samples',
].join('\n');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function file(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}
function inside(base, rel) {
  const path = normalize(join(base, rel));
  return path.startsWith(base) ? path : null;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const p = url.pathname;
  const m = req.method ?? 'GET';

  if (p === '/__mock/stop' && m === 'POST') {
    json(res, { ok: true });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
    return;
  }
  if (p === '/__mock/state' && m === 'POST') {
    const patch = await body(req);
    if (patch.reset) state = initial();
    state = { ...state, ...patch, config: { ...state.config, ...(patch.config ?? {}) } };
    return json(res, { ok: true });
  }
  if (p === '/__mock/last') return json(res, state);
  if (p.startsWith('/arbs/assets/')) return file(res, inside(dist, p.slice('/arbs/'.length)) ?? '');
  if (p === '/arbs' || p.startsWith('/arbs/')) return file(res, join(dist, 'index.html'));
  if (p.startsWith('/images/')) return file(res, inside(images, p.slice('/images/'.length)) ?? '');
  if (!p.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>mock ${p}</title><p>mock page ${p}${url.search}</p>`);
  }

  if (state.offline) {
    res.writeHead(503);
    return res.end();
  }
  const signedIn = state.auth.credentials_configured && !state.auth.login_required;
  if (p === '/api/configLocale') return json(res, { locale: 'ko', status: true });
  if (p === '/api/auth/status') return json(res, state.auth);
  if (p === '/api/csrf-token') return json(res, { csrf_token: 'mock-token' });
  if (p === '/api/auth/login' && m === 'POST') {
    state.auth = { authenticated: true, credentials_configured: true, login_required: false };
    return json(res, { status: true });
  }
  if (p === '/api/password' && m === 'POST') {
    state.auth = { authenticated: false, credentials_configured: true, login_required: true };
    return json(res, { status: true });
  }
  if (!signedIn) return json(res, { status: false, error: 'Unauthorized' }, 401);

  if (p === '/api/auth/logout') {
    state.auth = { ...state.auth, login_required: true, authenticated: false };
    return json(res, { status: true });
  }
  if (p === '/api/metadata')
    return json(res, {
      status: true,
      version: '0.2.0',
      platform: 'windows',
      architecture: 'x86_64',
      branch: 'arbs-h',
      commit: '0123456789abcdef0123456789abcdef01234567',
      release_date: '2026-11-25',
      encoder_status: { state: 'ready', h264: true, hevc: true, av1: false },
      virtual_display_driver: { configured: 'vibeshine', active: 'vibeshine', status: 'ok', status_code: 0 },
    });
  if (p === '/api/session/status') return json(res, state.session);
  if (p === '/api/host/stats') return json(res, { cpu_percent: 23, gpu_percent: 41 });
  if (p === '/api/config' && m === 'GET') return json(res, { status: true, platform: 'windows', version: '0.2.0', ...state.config });
  if (p === '/api/config' && m === 'PATCH') {
    const patch = await body(req);
    state.config = { ...state.config, ...patch };
    state.lastPatch = patch;
    return json(res, { status: true, appliedNow: true, deferred: false, restartRequired: false });
  }
  if (p === '/api/clients/list') return json(res, { status: true, platform: 'windows', named_certs: state.devices });
  if (/^\/api\/clients\/(update|unpair|disconnect)$/.test(p)) {
    state.lastClient = { path: p, body: await body(req) };
    return json(res, { status: true, allow_sleep_updated: true });
  }
  if (p === '/api/pin') return json(res, { status: true });
  if (p === '/api/apps' && m === 'GET') return json(res, { apps: state.apps });
  if (/^\/api\/apps\/[^/]+\/(cover|icon)$/.test(p)) return file(res, join(images, 'logo-apollo-45.png'));
  if (p.startsWith('/api/apps') || p.startsWith('/api/display') || p === '/api/reset-display-device-persistence') {
    if (p === '/api/display/golden_status') return json(res, state.golden);
    if (m !== 'GET') return json(res, { status: true });
  }
  if (p === '/api/rtsp/sessions')
    return json(res, {
      status: true,
      sessions: state.session.activeSessions
        ? [{ uuid: 'rtsp-1', device_name: 'Odin 2 Portal', width: 1920, height: 1080, fps: 60, codec: 'HEVC' }]
        : [],
    });
  if (p === '/api/webrtc/sessions') return json(res, { sessions: [] });
  if (p === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(LOG);
  }
  if (p === '/api/logs/export_crash/manifest') return json(res, { parts: [] });
  if (p === '/api/service/startup')
    return json(res, { status: true, installed: true, automatic: true, start_type: 'automatic', can_change: true, error: '', error_code: 0 });
  if (p === '/api/restart') return json(res, { status: true });
  return json(res, { status: false, error: 'mock: not handled' }, 404);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock ARBS-H on http://127.0.0.1:${port}/arbs/ (dist ${dist})`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
