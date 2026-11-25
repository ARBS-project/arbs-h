// ARBS-H UI1b: the 77 tier-1 IDs (docs/UI1_DECISIONS.md) match the card table and the screens.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CARD_LABELS, EXPECTED_CARD_COUNTS, FEATURES, type CardId } from '../logic/features.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const ID = /\bH-[A-Z0-9]+-\d{2,3}\b/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'scripts', 'dist'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(vue|ts|json|html|css|js)$/.test(name) && !/package(-lock)?\.json$/.test(name)) out.push(path);
  }
  return out;
}

test('77 unique IDs, card totals as in the analysis table', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(ids.length, 77);
  assert.equal(new Set(ids).size, 77);
  const counts: Record<string, number> = {};
  for (const f of FEATURES) counts[f.card] = (counts[f.card] ?? 0) + 1;
  assert.deepEqual(counts, EXPECTED_CARD_COUNTS);
  for (const f of FEATURES) assert.ok(CARD_LABELS[f.card as CardId], f.id);
});

test('every ID is on its screen (listed file contains the ID)', () => {
  for (const f of FEATURES) {
    assert.ok(f.files.length > 0, f.id);
    for (const file of f.files) {
      const text = readFileSync(join(root, file), 'utf8');
      assert.match(text, new RegExp(`${f.id}(?!\\d)`), `${f.id} missing in ${file}`);
    }
  }
});

test('no out-of-scope ID (tier 2, advanced, excluded) in the source', () => {
  const allowed = new Set(FEATURES.map((f) => f.id));
  for (const file of sourceFiles(root)) {
    for (const id of readFileSync(file, 'utf8').match(ID) ?? []) {
      assert.ok(allowed.has(id), `${id} in ${relative(root, file)} is not tier 1`);
    }
  }
});

test('no browser stream page (P1: H-V2STR-* excluded)', () => {
  const router = readFileSync(join(root, 'router.ts'), 'utf8');
  assert.doesNotMatch(router, /path:\s*'\/[^']*stream/i);
  const nav = readFileSync(join(root, 'components/NavMenu.vue'), 'utf8');
  assert.doesNotMatch(nav, /to:\s*'\/[^']*stream/i);
  for (const file of sourceFiles(root)) assert.doesNotMatch(readFileSync(file, 'utf8'), /webrtc\/sessions['`"]?\s*,\s*\{[^}]*offer|BrowserStream/, file);
});

test('matches docs/UI1_DECISIONS.md when the docs folder is next to the repository', (t) => {
  const path =
    process.env.ARBS_UI1_DECISIONS ??
    fileURLToPath(new URL('../../../../../../../docs/UI1_DECISIONS.md', import.meta.url));
  if (!existsSync(path)) {
    t.skip(`not found: ${path}`);
    return;
  }
  const text = readFileSync(path, 'utf8');
  const tier1 = text.slice(text.indexOf('## 1차'), text.indexOf('## 2차'));
  const rest = text.slice(text.indexOf('## 2차'));
  const docIds = [...new Set(tier1.match(/^\| (H-[A-Z0-9]+-\d{2,3}) \|/gm)!.map((l) => l.slice(2, -2)))];
  assert.equal(docIds.length, 77);
  assert.deepEqual([...docIds].sort(), FEATURES.map((f) => f.id).sort());
  const other = new Set(rest.match(ID) ?? []);
  assert.ok(other.size > 300, 'other tiers parsed');
  for (const f of FEATURES) assert.ok(!other.has(f.id), `${f.id} is also listed outside tier 1`);
});
