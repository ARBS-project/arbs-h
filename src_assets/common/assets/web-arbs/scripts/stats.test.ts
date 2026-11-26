// ARBS-H 0.2.1 (H021): statistics numbers from the existing API (logic/stats.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codecText,
  formatBitrate,
  fpsGrade,
  historyAvailable,
  hostUsage,
  jitterGrade,
  latencyGrade,
  liveFromHistory,
  liveFromRtsp,
  lossGrade,
  lossPercent,
  num,
  pickLive,
  recentFrom,
  splitDuration,
  summarizeSamples,
  verdictGrade,
  verdictOf,
} from '../logic/stats.ts';

// Field names as in src/confighttp.cpp active_session_to_json / rtsp_session_to_json.
const ACTIVE = {
  sessions: [
    {
      uuid: 'a-1',
      protocol: 'rtsp',
      client_name: 'client',
      device_name: 'Test device',
      app_name: 'Desktop',
      width: 1920,
      height: 1080,
      target_fps: 60,
      encoder_bitrate_kbps: 20000,
      requested_bitrate_kbps: 20000,
      codec: 'HEVC',
      hdr: true,
      yuv444: false,
      uptime_seconds: 3725.4,
      actual_fps: 59.6,
      actual_bitrate_kbps: 18456.2,
      encode_latency_ms: 4.2,
      frame_interval_jitter_ms: 0.84,
      frames_sent: 200000,
      bytes_sent: 1,
      client_reported_losses: 12,
      idr_requests: 3,
    },
  ],
};
const RTSP = {
  sessions: [
    { uuid: 'r-1', device_name: 'Test device', width: 1280, height: 720, fps: 120, encoder_bitrate_kbps: 15000, requested_bitrate_kbps: 15000, codec: 'H.264', hdr: false, yuv444: true, frames_sent: 0, client_reported_losses: 0, idr_requests: 0, encode_latency_ms: 18, uptime_seconds: 5 },
  ],
};

test('numbers: missing, text, negative (-1 = not measured) are null', () => {
  assert.equal(num(5), 5);
  assert.equal(num('2.5'), 2.5);
  assert.equal(num(-1), null);
  assert.equal(num(''), null);
  assert.equal(num('x'), null);
  assert.equal(num(undefined), null);
  assert.equal(num(Number.NaN), null);
});

test('live: history first, RTSP list when history has no active session', () => {
  const [s] = liveFromHistory(ACTIVE);
  assert.equal(s!.source, 'history');
  assert.equal(s!.device, 'Test device');
  assert.equal(s!.actualFps, 59.6);
  assert.equal(s!.bitrateKbps, 18456.2);
  assert.equal(s!.requestedKbps, 20000);
  assert.equal(s!.jitterMs, 0.84);
  assert.equal(pickLive(ACTIVE, RTSP)[0]!.source, 'history');
  const fallback = pickLive({ sessions: [] }, RTSP);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0]!.source, 'rtsp');
  assert.equal(fallback[0]!.targetFps, 120);
  assert.equal(fallback[0]!.actualFps, null);
  assert.equal(fallback[0]!.jitterMs, null);
  assert.deepEqual(pickLive(null, null), []);
  assert.deepEqual(liveFromRtsp({ sessions: [null, 3] }), []);
});

test('loss percentage and grade (server rule: > 5 % of sent frames = bad)', () => {
  assert.equal(lossPercent(12, 200000), 0);
  assert.equal(lossPercent(50, 1000), 5);
  assert.equal(lossPercent(51, 1000), 5.1);
  assert.equal(lossPercent(1, 0), null);
  assert.equal(lossPercent(null, 10), null);
  assert.equal(lossGrade(0, 1000), 'good');
  assert.equal(lossGrade(50, 1000), 'warn');
  assert.equal(lossGrade(51, 1000), 'bad');
  assert.equal(lossGrade(3, 0), 'warn');
  assert.equal(lossGrade(null, 1000), 'info');
});

test('fps grade boundaries 95 % / 90 % (proposal)', () => {
  assert.equal(fpsGrade(57, 60), 'good');
  assert.equal(fpsGrade(56.9, 60), 'warn');
  assert.equal(fpsGrade(54, 60), 'warn');
  assert.equal(fpsGrade(53.9, 60), 'bad');
  assert.equal(fpsGrade(null, 60), 'info');
  assert.equal(fpsGrade(60, 0), 'info');
});

test('encode latency (server rule 16 ms) and jitter (2 ms / one frame interval)', () => {
  assert.equal(latencyGrade(16), 'good');
  assert.equal(latencyGrade(16.1), 'warn');
  assert.equal(latencyGrade(null), 'info');
  assert.equal(jitterGrade(2, 60), 'good');
  assert.equal(jitterGrade(10, 60), 'warn');
  assert.equal(jitterGrade(16.7, 60), 'bad');
  assert.equal(jitterGrade(10, 120), 'bad');
  assert.equal(jitterGrade(10, null), 'warn');
  assert.equal(jitterGrade(null, 60), 'info');
});

test('verdict words map to grades; unknown for anything else', () => {
  assert.equal(verdictOf('healthy'), 'healthy');
  assert.equal(verdictOf('degraded'), 'degraded');
  assert.equal(verdictOf('failed'), 'failed');
  assert.equal(verdictOf('weird'), 'unknown');
  assert.equal(verdictGrade('healthy'), 'good');
  assert.equal(verdictGrade('degraded'), 'warn');
  assert.equal(verdictGrade('failed'), 'bad');
  assert.equal(verdictGrade('unknown'), 'info');
});

test('recent sessions list and history availability', () => {
  const payload = {
    sessions: [
      { uuid: 'u1', device_name: '', client_name: 'Client A', app_name: 'Desktop', width: 1920, height: 1080, target_fps: 60, codec: 'AV1', start_time_unix: 1764000000, duration_seconds: 125.5, verdict: 'healthy' },
      { device_name: 'no uuid' },
    ],
    history_status: { available: true },
  };
  const list = recentFrom(payload);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.device, 'Client A');
  assert.equal(list[0]!.verdict, 'healthy');
  assert.equal(historyAvailable(payload), true);
  assert.equal(historyAvailable({ sessions: [], history_status: { available: false } }), false);
  assert.equal(historyAvailable({ sessions: [] }), true);
});

test('session detail summary from samples (counters are running totals, -1 ignored)', () => {
  const detail = {
    samples: [
      { actual_fps: 60, actual_bitrate_kbps: 20000, encode_latency_ms: 4, client_reported_losses: 0, frames_sent: 600, video_dropped: 0, frame_interval_jitter_ms: 1 },
      { actual_fps: 58, actual_bitrate_kbps: 18000, encode_latency_ms: 20, client_reported_losses: 6, frames_sent: 1200, video_dropped: 2, frame_interval_jitter_ms: 3 },
      { actual_fps: -1, actual_bitrate_kbps: -1, encode_latency_ms: -1, client_reported_losses: 6, frames_sent: 1200, video_dropped: 2, frame_interval_jitter_ms: -1 },
    ],
  };
  const s = summarizeSamples(detail);
  assert.equal(s.count, 3);
  assert.equal(s.avgFps, 59);
  assert.equal(s.avgBitrateKbps, 19000);
  assert.equal(s.avgLatencyMs, 12);
  assert.equal(s.maxLatencyMs, 20);
  assert.equal(s.maxLossPercent, 0.5);
  assert.equal(s.videoDropped, 2);
  assert.equal(s.avgJitterMs, 2);
  const empty = summarizeSamples({ samples: [] });
  assert.equal(empty.count, 0);
  assert.equal(empty.avgFps, null);
  assert.equal(empty.maxLossPercent, null);
  assert.equal(summarizeSamples(null).count, 0);
});

test('host usage (cpu, gpu, encoder %), formatting helpers', () => {
  assert.deepEqual(hostUsage({ cpu_percent: 23.4, gpu_percent: 41, gpu_encoder_percent: -1 }), { cpu: 23, gpu: 41, encoder: null });
  assert.deepEqual(hostUsage(null), { cpu: null, gpu: null, encoder: null });
  assert.equal(formatBitrate(18456.2), '18.5 Mbps');
  assert.equal(formatBitrate(800), '800 kbps');
  assert.equal(formatBitrate(null), '');
  assert.deepEqual(splitDuration(3725.4), { h: 1, m: 2, s: 5 });
  assert.equal(splitDuration(null), null);
  assert.equal(codecText({ codec: 'HEVC', hdr: true, yuv444: false }), 'HEVC · HDR');
  assert.equal(codecText({ codec: 'H.264', hdr: false, yuv444: true }), 'H.264 · 4:4:4');
});
