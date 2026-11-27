// ARBS-H 0.3.1 (H031 G1): the side decks of the small icons never touch the tile edge. Reads the shipped .ico copies
// (32-bit BMP entries up to 64 px) and counts whole orange pixels between the first fully opaque pixel of each row and the
// first pixel of any other colour. Badge states: rows whose first other-coloured pixel from the right lies in the badge
// circle are skipped on that side (the badge sits on the corner by design). Same rule as arbs branding/check/margins.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../..', import.meta.url));
const repo = fileURLToPath(new URL('../../../../..', import.meta.url));

/** size -> RGBA (top-down) for the 32-bit BMP entries of an .ico file. */
function icoEntries(path: string): Map<number, Uint8Array> {
  const b = readFileSync(path);
  const out = new Map<number, Uint8Array>();
  for (let i = 0; i < b.readUInt16LE(4); i++) {
    const e = 6 + 16 * i;
    const size = b[e] || 256;
    const len = b.readUInt32LE(e + 8);
    const off = b.readUInt32LE(e + 12);
    const d = b.subarray(off, off + len);
    if (d.readUInt32LE(0) !== 40 || d.readUInt16LE(14) !== 32) continue; // PNG or other entries
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = 40 + ((size - 1 - y) * size + x) * 4;
        const t = (y * size + x) * 4;
        rgba[t] = d[s + 2]!;
        rgba[t + 1] = d[s + 1]!;
        rgba[t + 2] = d[s]!;
        rgba[t + 3] = d[s + 3]!;
      }
    }
    out.set(size, rgba);
  }
  return out;
}

function margins(rgba: Uint8Array, size: number, badge: boolean): { left: number; right: number } {
  const orange = (i: number) => rgba[i + 3] === 255 && Math.abs(rgba[i]! - 0xc2) <= 3 && Math.abs(rgba[i + 1]! - 0x41) <= 3 && Math.abs(rgba[i + 2]! - 0x0c) <= 3;
  const d = badge ? Math.round((7 * size) / 16) : 0;
  const c = size - d / 2;
  const inBadge = (x: number, y: number) => d > 0 && (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= (d / 2 + 1) ** 2;
  let left = Infinity;
  let right = Infinity;
  for (let y = 0; y < size; y++) {
    const px = (x: number) => (y * size + x) * 4;
    let x0 = 0;
    while (x0 < size && rgba[px(x0) + 3] !== 255) x0++;
    let x1 = size - 1;
    while (x1 >= 0 && rgba[px(x1) + 3] !== 255) x1--;
    if (x0 > x1) continue;
    let other = false;
    for (let x = x0; x <= x1; x++) if (!orange(px(x))) other = true;
    if (!other) continue;
    let k = 0;
    while (x0 + k <= x1 && orange(px(x0 + k))) k++;
    left = Math.min(left, k);
    let r = 0;
    while (x1 - r >= x0 && orange(px(x1 - r))) r++;
    if (!inBadge(x1 - r, y)) right = Math.min(right, r);
  }
  return { left, right };
}

const NEED: Record<number, number> = { 16: 1, 20: 2, 24: 2 };

test('G1: app icon, favicons: side decks at 16 / 20 / 24 px keep 1 / 2 / 2 orange pixels from the tile edge', () => {
  for (const file of [
    join(repo, 'branding/arbs.ico'),
    join(assets, 'web-arbs/public/images/favicon.ico'),
    join(assets, 'web-legacy/public/images/arbs-favicon.ico'),
    join(assets, 'web/public/images/arbs-favicon.ico'),
  ]) {
    const entries = icoEntries(file);
    for (const [size, need] of Object.entries(NEED).map(([s, n]) => [Number(s), n] as const)) {
      const rgba = entries.get(size);
      if (!rgba) continue; // favicon has no 20 / 24 entry
      const m = margins(rgba, size, false);
      assert.ok(m.left >= need && m.right >= need, `${file} ${size}px: ${JSON.stringify(m)}`);
    }
    assert.ok(entries.has(16), `${file} has a 16 px entry`);
  }
});

test('G1: tray icons (all four states) keep the decks clear of the edge at 16 / 20 / 24 / 32 px', () => {
  const need = { ...NEED, 32: 2 } as Record<number, number>;
  for (const state of ['', '-playing', '-pausing', '-locked']) {
    const entries = icoEntries(join(assets, `web-legacy/public/images/arbs-tray${state}.ico`));
    for (const size of [16, 20, 24, 32]) {
      const rgba = entries.get(size);
      assert.ok(rgba, `tray${state} ${size}px entry`);
      const m = margins(rgba!, size, state !== '');
      assert.ok(m.left >= need[size]! && m.right >= need[size]!, `tray${state} ${size}px: ${JSON.stringify(m)}`);
    }
  }
});
