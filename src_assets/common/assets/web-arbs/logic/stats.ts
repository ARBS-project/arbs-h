// ARBS-H 0.2.1 (H021): stream statistics from the existing ARBS-H API only (docs/analysis/H021.md §5).
//   live    GET /api/history/sessions/active (src/confighttp.cpp active_session_to_json), else
//           GET /api/rtsp/sessions (rtsp_session_to_json: no actual fps / jitter)
//   recent  GET /api/history/sessions?limit=&offset= (session_summary_to_json)
//   detail  GET /api/history/sessions/{uuid} (session_detail_to_json, samples)
//   host    GET /api/host/stats (host_stats_to_json)
// "Latency" here is the host encode latency. The network round trip is not in the host API.
// Good/bad limits: server verdict rules (src/session_history_storage.cpp process_end_at: loss over
// 5 % of sent frames = failed, any encode latency over 16 ms or any loss = degraded) and, marked
// "proposal", design values (fps 95 % / 90 %, jitter 2 ms / one frame interval).

export type Grade = 'good' | 'warn' | 'bad' | 'info';

/** A number from the API, or null when missing, not a number or negative (-1 = not measured). */
export function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface LiveSession {
  key: string;
  source: 'history' | 'rtsp';
  device: string;
  app: string;
  width: number | null;
  height: number | null;
  targetFps: number | null;
  actualFps: number | null;
  codec: string;
  hdr: boolean;
  yuv444: boolean;
  bitrateKbps: number | null;
  requestedKbps: number | null;
  encodeLatencyMs: number | null;
  jitterMs: number | null;
  losses: number | null;
  framesSent: number | null;
  idrRequests: number | null;
  uptimeSeconds: number | null;
}

function sessions(payload: unknown): Record<string, unknown>[] {
  const list = payload && typeof payload === 'object' ? (payload as { sessions?: unknown }).sessions : undefined;
  return Array.isArray(list) ? list.filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object')) : [];
}

/** Active sessions from GET /api/history/sessions/active. */
export function liveFromHistory(payload: unknown): LiveSession[] {
  return sessions(payload).map((s, i) => ({
    key: str(s.uuid) || `h${i}`,
    source: 'history',
    device: str(s.device_name) || str(s.client_name),
    app: str(s.app_name),
    width: num(s.width),
    height: num(s.height),
    targetFps: num(s.target_fps),
    actualFps: num(s.actual_fps),
    codec: str(s.codec),
    hdr: s.hdr === true,
    yuv444: s.yuv444 === true,
    bitrateKbps: num(s.actual_bitrate_kbps),
    requestedKbps: num(s.requested_bitrate_kbps) ?? num(s.encoder_bitrate_kbps),
    encodeLatencyMs: num(s.encode_latency_ms),
    jitterMs: num(s.frame_interval_jitter_ms),
    losses: num(s.client_reported_losses),
    framesSent: num(s.frames_sent),
    idrRequests: num(s.idr_requests),
    uptimeSeconds: num(s.uptime_seconds),
  }));
}

/** Fallback from GET /api/rtsp/sessions (history off): no actual fps, no jitter. */
export function liveFromRtsp(payload: unknown): LiveSession[] {
  return sessions(payload).map((s, i) => ({
    key: str(s.uuid) || `r${i}`,
    source: 'rtsp',
    device: str(s.device_name),
    app: '',
    width: num(s.width),
    height: num(s.height),
    targetFps: num(s.fps),
    actualFps: null,
    codec: str(s.codec),
    hdr: s.hdr === true,
    yuv444: s.yuv444 === true,
    bitrateKbps: num(s.encoder_bitrate_kbps),
    requestedKbps: num(s.requested_bitrate_kbps),
    encodeLatencyMs: num(s.encode_latency_ms),
    jitterMs: null,
    losses: num(s.client_reported_losses),
    framesSent: num(s.frames_sent),
    idrRequests: num(s.idr_requests),
    uptimeSeconds: num(s.uptime_seconds),
  }));
}

/** History first; when it has no active session (history off or not started), the RTSP list. */
export function pickLive(history: unknown, rtsp: unknown): LiveSession[] {
  const fromHistory = liveFromHistory(history);
  return fromHistory.length ? fromHistory : liveFromRtsp(rtsp);
}

/** Losses as a percentage of the frames sent, one decimal; null when nothing was sent. */
export function lossPercent(losses: number | null, frames: number | null): number | null {
  if (losses === null || frames === null || frames <= 0) return null;
  return Math.round((losses / frames) * 1000) / 10;
}

/** Proposal: actual >= 95 % of the target is good, below 90 % is bad. */
export function fpsGrade(actual: number | null, target: number | null): Grade {
  if (actual === null || target === null || target <= 0) return 'info';
  const ratio = actual / target;
  if (ratio >= 0.95) return 'good';
  if (ratio < 0.9) return 'bad';
  return 'warn';
}

/** Server rule: 0 losses good, over 5 % of the sent frames bad, otherwise caution. */
export function lossGrade(losses: number | null, frames: number | null): Grade {
  if (losses === null) return 'info';
  if (losses === 0) return 'good';
  if (frames !== null && frames > 0 && losses / frames > 0.05) return 'bad';
  return 'warn';
}

/** Server rule: encode latency up to 16 ms is good, above is caution. */
export function latencyGrade(ms: number | null): Grade {
  if (ms === null) return 'info';
  return ms <= 16 ? 'good' : 'warn';
}

/** Proposal: jitter up to 2 ms good, more than one frame interval (1000 / fps ms) bad. */
export function jitterGrade(ms: number | null, fps: number | null): Grade {
  if (ms === null) return 'info';
  if (ms <= 2) return 'good';
  if (fps !== null && fps > 0 && ms > 1000 / fps) return 'bad';
  return 'warn';
}

export type Verdict = 'healthy' | 'degraded' | 'failed' | 'unknown';
export function verdictOf(value: unknown): Verdict {
  return value === 'healthy' || value === 'degraded' || value === 'failed' ? value : 'unknown';
}
export function verdictGrade(verdict: Verdict): Grade {
  return verdict === 'healthy' ? 'good' : verdict === 'degraded' ? 'warn' : verdict === 'failed' ? 'bad' : 'info';
}

export interface RecentSession {
  uuid: string;
  device: string;
  app: string;
  width: number | null;
  height: number | null;
  targetFps: number | null;
  codec: string;
  startUnix: number | null;
  durationSeconds: number | null;
  verdict: Verdict;
}

export function recentFrom(payload: unknown): RecentSession[] {
  return sessions(payload)
    .map((s) => ({
      uuid: str(s.uuid),
      device: str(s.device_name) || str(s.client_name),
      app: str(s.app_name),
      width: num(s.width),
      height: num(s.height),
      targetFps: num(s.target_fps),
      codec: str(s.codec),
      startUnix: num(s.start_time_unix),
      durationSeconds: num(s.duration_seconds),
      verdict: verdictOf(s.verdict),
    }))
    .filter((s) => s.uuid !== '');
}

/** history_status.available from the list or detail answer (true when the field is missing). */
export function historyAvailable(payload: unknown): boolean {
  const status = payload && typeof payload === 'object' ? (payload as { history_status?: unknown }).history_status : undefined;
  if (!status || typeof status !== 'object') return true;
  return (status as { available?: unknown }).available !== false;
}

export interface SampleSummary {
  count: number;
  avgFps: number | null;
  avgBitrateKbps: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  maxLossPercent: number | null;
  videoDropped: number | null;
  avgJitterMs: number | null;
}

function avg(values: (number | null)[]): number | null {
  const list = values.filter((v): v is number => v !== null);
  if (!list.length) return null;
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
}
function max(values: (number | null)[]): number | null {
  const list = values.filter((v): v is number => v !== null);
  return list.length ? Math.max(...list) : null;
}

/**
 * Numbers for one finished session from its samples. Counters in a sample are running totals,
 * so losses and dropped frames use the largest value (same as the server verdict).
 */
export function summarizeSamples(detail: unknown): SampleSummary {
  const raw = detail && typeof detail === 'object' ? (detail as { samples?: unknown }).samples : undefined;
  const samples = Array.isArray(raw) ? raw.filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object')) : [];
  const losses = max(samples.map((s) => num(s.client_reported_losses)));
  const frames = max(samples.map((s) => num(s.frames_sent)));
  return {
    count: samples.length,
    avgFps: avg(samples.map((s) => num(s.actual_fps))),
    avgBitrateKbps: avg(samples.map((s) => num(s.actual_bitrate_kbps))),
    avgLatencyMs: avg(samples.map((s) => num(s.encode_latency_ms))),
    maxLatencyMs: max(samples.map((s) => num(s.encode_latency_ms))),
    maxLossPercent: lossPercent(losses, frames),
    videoDropped: max(samples.map((s) => num(s.video_dropped))),
    avgJitterMs: avg(samples.map((s) => num(s.frame_interval_jitter_ms))),
  };
}

export interface HostUsage {
  cpu: number | null;
  gpu: number | null;
  encoder: number | null;
}
export function hostUsage(payload: unknown): HostUsage {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const pct = (v: unknown) => {
    const n = num(v);
    return n === null ? null : Math.round(Math.min(100, n));
  };
  return { cpu: pct(p.cpu_percent), gpu: pct(p.gpu_percent), encoder: pct(p.gpu_encoder_percent) };
}

/** "12.3 Mbps" from kbps (one decimal), "800 kbps" below 1 Mbps. */
export function formatBitrate(kbps: number | null): string {
  if (kbps === null) return '';
  return kbps >= 1000 ? `${(Math.round(kbps / 100) / 10).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}

/** Hours, minutes, seconds for the duration text. */
export function splitDuration(seconds: number | null): { h: number; m: number; s: number } | null {
  if (seconds === null) return null;
  const total = Math.floor(seconds);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** Codec with HDR / 4:4:4 marks, e.g. "HEVC · HDR". */
export function codecText(s: { codec: string; hdr: boolean; yuv444: boolean }): string {
  return [s.codec || '', s.hdr ? 'HDR' : '', s.yuv444 ? '4:4:4' : ''].filter(Boolean).join(' · ');
}
