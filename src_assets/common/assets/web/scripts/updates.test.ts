import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectAvailableUpdate as selectWireUpdate,
  prereleasesEnabled,
  validNightlyMetadata,
  fetchUpdateReleases,
  dismissUpdate,
  dismissedUpdate,
  type UpdateRelease,
} from '../utils/updates.ts';
import {
  RELEASES_API,
  RELEASES_PAGE,
  isReleasePageUrl,
  windowsSetupAsset,
} from '../utils/repo.ts';

// ARBS-H R1a: the Windows installer name depends on the tag (arbs-h-<version>-setup.exe).
// Fixtures carry a placeholder that is filled in for the tag right before selection.
const SETUP = '@windows-setup@';
function fixAssets(r: UpdateRelease): UpdateRelease {
  if (!r || typeof r !== 'object' || !Array.isArray(r.assets) || typeof r.tag_name !== 'string') return r;
  const tag = r.tag_name;
  return { ...r, assets: r.assets.map((a) => (a.name === SETUP ? { ...a, name: windowsSetupAsset(tag) } : a)) };
}
function selectWire(...args: Parameters<typeof selectWireUpdate>) {
  args[1] = args[1].map(fixAssets);
  return selectWireUpdate(...args);
}

// Convert semantic-order fixtures to the release API wire contract.
function selectAvailableUpdate(...args: Parameters<typeof selectWireUpdate>) {
  args[1] = args[1].map((r) => r.nightly_metadata
    ? { ...r, body: `<!-- nightly-identity: ${JSON.stringify(r.nightly_metadata)} -->\n` } : r);
  return selectWire(...args);
}

const assets = [{ name: SETUP, state: 'uploaded', size: 100 }];
function release(tag: string, prerelease = false): UpdateRelease {
  return { tag_name: tag, draft: false, prerelease, assets };
}
function daily(date: string, base = '2.0.0'): UpdateRelease {
  const tag = `daily-${date}`;
  const sha = 'a'.repeat(40);
  return {
    ...release(tag, true),
    assets: [
      ...assets,
      { name: 'nightly-metadata.json', state: 'uploaded', size: 100 },
      { name: 'SHA256SUMS', state: 'uploaded', size: 100 },
    ],
    nightly_metadata: {
      schema_version: 1,
      channel: 'nightly',
      tag,
      version: `${base}-daily.d${date.replaceAll('-', '')}+${sha.slice(0, 12)}`,
      source_commit: sha,
      nightly_sequence: Number(date.replaceAll('-', '')),
    },
  };
}
function nightly(date: string, sha = 'a'.repeat(40), base = '2.0.1'): UpdateRelease {
  const compact = date.replaceAll('-', '');
  const tag = base + '-nightly.d' + compact + '.' + sha.slice(0, 12);
  return {
    ...release(tag, true),
    assets: [...assets, { name: 'nightly-metadata.json', state: 'uploaded', size: 100 },
      { name: 'SHA256SUMS', state: 'uploaded', size: 100 }],
    nightly_metadata: { schema_version: 1, channel: 'nightly', tag, version: tag,
      source_commit: sha, nightly_sequence: Number(compact) },
  };
}
const releases = [
  release('v2.0.0-beta.10', true),
  release('v1.9.0-stable.2'),
  release('v2.0.0-beta.2', true),
  { ...release('v3.0.0'), draft: true },
];

test('new and missing settings enable prereleases, explicit prior choices survive', () => {
  for (const value of [undefined, null, true, 'enabled', 'true', 1, '1']) {
    assert.equal(prereleasesEnabled(value), true);
    assert.equal(selectAvailableUpdate('1.9.0-stable.1', releases, value)?.tag, '2.0.0-beta.10');
  }
  for (const value of [false, 'disabled', 'false', 0, '0']) {
    assert.equal(prereleasesEnabled(value), false);
    assert.equal(selectAvailableUpdate('1.9.0-stable.1', releases, value)?.tag, '1.9.0-stable.2');
    assert.equal(selectAvailableUpdate('2.0.0-beta.2', releases, value), null);
  }
});
test('stable supersedes beta, numeric ordering and unknown versions', () => {
  assert.equal(selectAvailableUpdate('2.0.0-beta.2', releases, true)?.tag, '2.0.0-beta.10');
  assert.equal(
    selectAvailableUpdate('2.0.0-beta.10', [...releases, release('2.0.0')], false)?.tag,
    '2.0.0',
  );
  for (const version of ['', 'unknown', '9999999999999999999.0.0', '3.0.0'])
    assert.equal(selectAvailableUpdate(version, releases, true), null);
});
test('daily identity uses version family, sequence and verified source, stable same-base wins', () => {
  const days = [daily('2026-10-10'), daily('2026-10-11'), daily('2026-10-12', '1.0.0')];
  assert.equal(
    selectAvailableUpdate('2.0.0-daily.d20261010+aaaaaaaaaaaa', days, true)?.tag,
    'daily-2026-10-11',
  );
  assert.equal(selectAvailableUpdate('2.0.0-daily.d20261011+aaaaaaaaaaaa', days, true), null);
  assert.equal(selectAvailableUpdate('2.0.0', days, true), null);
  assert.equal(selectAvailableUpdate('2.0.0-beta.1', days, true), null);
  assert.equal(
    selectAvailableUpdate(
      '2.0.0-daily.d20261011+aaaaaaaaaaaa',
      [release('2.0.0-rc.1', true)],
      true,
    ),
    null,
  );
  assert.equal(
    selectAvailableUpdate('2.0.0-daily.d20261010+aaaaaaaaaaaa', [...days, release('2.0.0')], true)
      ?.tag,
    '2.0.0',
  );
  assert.equal(selectAvailableUpdate('1.9.0', days, false), null);
  const bad = daily('2026-10-11');
  bad.nightly_metadata!.source_commit = 'bad';
  assert.equal(validNightlyMetadata(bad.tag_name!, bad.nightly_metadata), false);
  assert.equal(selectAvailableUpdate('1.9.0', [bad], true), null);
});
test('published versioned setup and Arch package names retain stable notifications', () => {
  const current = {
    ...release('2.0.0'),
    assets: [{ name: 'arbs-h-2.0.0-setup.exe', state: 'uploaded', size: 100 }],
  };
  assert.equal(selectAvailableUpdate('1.18.4-stable.4', [current], false)?.tag, '2.0.0');
  const arch = {
    ...release('2.0.0'),
    assets: [{ name: 'vibepollo-2.0.0-1-x86_64.pkg.tar.zst', state: 'uploaded', size: 100 }],
  };
  assert.equal(selectAvailableUpdate('1.18.4', [arch], false, 'linux', 'x86_64')?.tag, '2.0.0');
  assert.equal(selectAvailableUpdate('1.18.4', [arch], false, 'linux', 'aarch64'), null);
});
test('draft, incomplete, malformed and incompatible packages never notify', () => {
  const incomplete = daily('2026-10-11');
  incomplete.assets = assets;
  assert.equal(
    selectAvailableUpdate(
      '1.0.0',
      [
        incomplete,
        { ...release('4.0.0'), assets: [{ name: 'arbs-h-4.0.0-setup.exe', state: 'new', size: 0 }] },
        { tag_name: '5.0.0' },
        release('junk'),
      ],
      true,
    ),
    null,
  );
  assert.equal(selectAvailableUpdate('1.0.0', [release('4.0.0')], true, 'linux'), null);
});
test('dismissed identities survive repeated checks and storage reconstruction', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  dismissUpdate(storage, 'daily-2026-10-11');
  dismissUpdate(storage, '2.0.0');
  for (let i = 0; i < 3; i++)
    assert.equal(dismissedUpdate({ ...storage }, 'daily-2026-10-11'), true);
  assert.equal(dismissedUpdate(storage, 'daily-2026-10-12'), false);
});
test('pagination is atomic, rate and malformed responses never yield partial updates', async () => {
  const previous = globalThis.fetch;
  try {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify(calls.length === 1 ? Array(100).fill(release('1.0.0')) : [release('2.0.0')]),
      );
    }) as typeof fetch;
    assert.equal((await fetchUpdateReleases(new AbortController().signal)).length, 101);
    assert.match(calls[1]!, /page=2$/);
    let call = 0;
    globalThis.fetch = (async () =>
      ++call === 1
        ? new Response(JSON.stringify(Array(100).fill(release('1.0.0'))))
        : new Response('{}', { status: 403 })) as typeof fetch;
    await assert.rejects(fetchUpdateReleases(new AbortController().signal));
    globalThis.fetch = (async () => new Response('{"message":"rate limited"}')) as typeof fetch;
    await assert.rejects(fetchUpdateReleases(new AbortController().signal));
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(Array(100).fill(release('1.0.0'))))) as typeof fetch;
    await assert.rejects(
      fetchUpdateReleases(new AbortController().signal),
      /pagination-incomplete/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});


test('Apollo macOS notices require the uploaded package for the reported architecture', () => {
  const mac = (name: string, size = 100, prerelease = false): UpdateRelease => ({
    ...release(prerelease ? '2.0.0-beta.1' : '2.0.0', prerelease),
    assets: [{ name, state: 'uploaded', size }],
  });
  const intel = mac('Vibepollo-macOS-x86_64.dmg');
  const arm = mac('Vibepollo-macOS-arm64.dmg');
  assert.equal(selectAvailableUpdate('1.9.0', [intel], false, 'macos', 'x86_64')?.tag, '2.0.0');
  assert.equal(selectAvailableUpdate('1.9.0', [arm], false, 'macos', 'aarch64')?.tag, '2.0.0');
  assert.equal(selectAvailableUpdate('1.9.0', [arm], true, 'macos', 'x86_64'), null);
  assert.equal(selectAvailableUpdate('1.9.0', [intel], true, 'macos', 'aarch64'), null);
  assert.equal(selectAvailableUpdate('1.9.0', [intel], true, 'macos', 'unknown'), null);
  for (const invalid of [mac('Vibeshine-macOS-x86_64.dmg'), mac('Vibepollo-macOS-x86_64.dmg', 0), release('2.0.0')])
    assert.equal(selectAvailableUpdate('1.9.0', [invalid], true, 'macos', 'x86_64'), null);
  const beta = mac('Vibepollo-macOS-x86_64.dmg', 100, true);
  assert.equal(selectAvailableUpdate('1.9.0', [beta], false, 'macos', 'x86_64'), null);
  assert.equal(selectAvailableUpdate('1.9.0', [beta], true, 'macos', 'x86_64')?.tag, '2.0.0-beta.1');
  const nightly = daily('2026-10-11');
  nightly.assets = [arm.assets![0]!, ...nightly.assets!.slice(1)];
  assert.equal(selectAvailableUpdate('1.9.0', [nightly], true, 'macos', 'aarch64')?.tag, 'daily-2026-10-11');
  nightly.assets = [arm.assets![0]!];
  assert.equal(selectAvailableUpdate('1.9.0', [nightly], true, 'macos', 'aarch64'), null);
});

test('post-stable nightly and same-day revisions upgrade, opt-out and final stable win', () => {
  const revised = daily('2026-10-11', '2.0.1');
  revised.tag_name = 'daily-2026-10-11.2';
  Object.assign(revised.nightly_metadata!, {tag: revised.tag_name, version: '2.0.1-daily.d20261011.2+aaaaaaaaaaaa', nightly_sequence: 20261011002});
  for (const installed of ['2.0.0', '2.0.0-daily.d20261011+aaa39188cc78', '2.0.0-daily.d20261011+0d62c962e081', '2.0.1-daily.d20261011+bbbbbbbbbbbb'])
    assert.equal(selectAvailableUpdate(installed, [revised], true)?.tag, revised.tag_name);
  for (const installed of ['2.0.1-daily.d20261011.2+aaaaaaaaaaaa', '2.0.1-daily.d20261012+bbbbbbbbbbbb', '2.0.1'])
    assert.equal(selectAvailableUpdate(installed, [revised], true), null);
  assert.equal(selectAvailableUpdate('2.0.0', [revised], false), null);
  assert.equal(selectAvailableUpdate('2.0.1-daily.d20261011.2+aaaaaaaaaaaa', [revised, release('2.0.1')], true)?.tag, '2.0.1');
  revised.nightly_metadata!['nightly_sequence'] = 20261011;
  assert.equal(validNightlyMetadata(revised.tag_name!, revised.nightly_metadata), false);
});


test('SemVer GitHub nightly tags notify shipped stable clients and retain metadata gates', () => {
  const next = daily('2026-10-12', '2.0.1');
  next.tag_name = '2.0.1-daily.d20261012.1';
  Object.assign(next.nightly_metadata!, { tag: next.tag_name, version: next.tag_name + '+aaaaaaaaaaaa', nightly_sequence: 20261012001 });
  assert.equal(selectAvailableUpdate('2.0.0', [next], undefined)?.tag, next.tag_name);
  assert.equal(selectAvailableUpdate('2.0.0', [next], false), null);
  assert.equal(selectAvailableUpdate('2.0.1-daily.d20261011.2+aaaaaaaaaaaa', [next], true)?.tag, next.tag_name);
  assert.equal(selectAvailableUpdate('2.0.1', [next], true), null);
  for (const changed of [
    {...next, nightly_metadata: undefined},
    {...next, nightly_metadata: {...next.nightly_metadata, tag: 'daily-2026-10-12.1'}},
    {...next, nightly_metadata: {...next.nightly_metadata, version: '2.0.2-daily.d20261012.1+aaaaaaaaaaaa'}},
    {...next, assets: assets},
  ]) assert.equal(selectAvailableUpdate('2.0.0', [changed], true), null);
});

test('new nightly updates preserve legacy upgrade, date order and SHA-as-identity', () => {
  const old = '2.0.1-daily.d20261022.2+aaaaaaaaaaaa';
  const current = nightly('2026-10-22', 'b'.repeat(40));
  const sameDate = nightly('2026-10-22', 'c'.repeat(40));
  const tomorrow = nightly('2026-10-23', '0'.repeat(40));
  assert.equal(selectAvailableUpdate(old, [current], true)?.tag, current.tag_name);
  assert.equal(selectAvailableUpdate(current.tag_name!, [current], true), null);
  assert.equal(selectAvailableUpdate(current.tag_name!, [sameDate], true), null);
  assert.equal(selectAvailableUpdate(current.tag_name!, [tomorrow], true)?.tag, tomorrow.tag_name);
  assert.equal(selectAvailableUpdate('2.0.0', [tomorrow], false), null);
  assert.equal(selectAvailableUpdate('2.0.1', [tomorrow], true), null);
  assert.equal(selectAvailableUpdate(current.tag_name!, [release('2.0.1')], true)?.tag, '2.0.1');
  for (const tamper of [
    { ...current, nightly_metadata: { ...current.nightly_metadata, source_commit: 'c'.repeat(40) } },
    { ...current, nightly_metadata: { ...current.nightly_metadata, version: current.tag_name + '+bbbb' } },
    { ...current, assets },
  ]) assert.equal(selectAvailableUpdate('2.0.0', [tamper], true), null);
});

test('daily availability uses only release API requests and embedded validated identity', async () => {
  const previous = globalThis.fetch;
  const next = daily('2026-10-12', '2.0.1');
  next.body = `<!-- nightly-identity: ${JSON.stringify(next.nightly_metadata)} -->\n`;
  delete next.nightly_metadata;
  next.assets = next.assets!.filter((a) => a.name !== 'nightly-metadata.json');
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify([next]));
    }) as typeof fetch;
    const releases = await fetchUpdateReleases(new AbortController().signal);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^https:\/\/api.github.com\/repos\//);
    assert.ok(calls[0]!.startsWith(`${RELEASES_API}?`));
    assert.ok(calls[0]!.startsWith('https://api.github.com/repos/arbs-project/arbs-h/releases?'));
    assert.equal(selectWire('2.0.0', releases, true)?.tag, next.tag_name);
    assert.equal(selectWire('2.0.0', releases, false), null);
    assert.equal(selectWire('2.0.1', releases, true), null);
    assert.equal(selectWire('2.0.0', [{...next, body: next.body + next.body}], true), null);
    assert.equal(selectWire('2.0.0', [{...next, body: ''}], true), null);
  } finally { globalThis.fetch = previous; }
});

function revisedNightly(date: string, revision: number, sha = 'b'.repeat(40)): UpdateRelease {
  const result = nightly(date, sha);
  const compact = date.replaceAll('-', '');
  const tag = `2.0.1-nightly.d${compact}.r.${revision}.${sha.slice(0,12)}`;
  result.tag_name = tag;
  Object.assign(result.nightly_metadata!, {tag, version: tag, nightly_sequence: Number(compact)*1000+revision});
  return result;
}

test('same-day revised nightly UI ordering matches backend and ignores SHA order', () => {
  const old = nightly('2026-10-22', 'f'.repeat(40));
  const first = revisedNightly('2026-10-22', 1, '0'.repeat(40));
  const second = revisedNightly('2026-10-22', 2, 'a'.repeat(40));
  const tenth = revisedNightly('2026-10-22', 10, '1'.repeat(40));
  const releases = [old, tenth, second, first];
  assert.equal(selectAvailableUpdate(old.tag_name!, releases, true)?.tag, tenth.tag_name);
  assert.equal(selectAvailableUpdate(first.tag_name!, releases, true)?.tag, tenth.tag_name);
  assert.equal(selectAvailableUpdate(tenth.tag_name!, releases, true), null);
  assert.equal(selectAvailableUpdate(first.tag_name!, [old], true), null);
  assert.equal(selectAvailableUpdate('2.0.1', releases, true), null);
  assert.equal(selectAvailableUpdate('2.0.0', releases, false), null);
  assert.equal(selectAvailableUpdate('2.0.1-daily.d20261021.999+aaaaaaaaaaaa', [first], true)?.tag, first.tag_name);
  assert.equal(selectAvailableUpdate('2.0.1-daily.d20261023.1+aaaaaaaaaaaa', [first], true), null);
  assert.equal(selectAvailableUpdate(first.tag_name!, [daily('2026-10-23','2.0.1')], true)?.tag, 'daily-2026-10-23');
});

test('revised nightly UI qualification requires metadata, checksums, exact source and calendar', () => {
  const first = revisedNightly('2026-10-22', 1);
  assert.equal(validNightlyMetadata(first.tag_name!, first.nightly_metadata), true);
  const wire = {...first, body: `<!-- nightly-identity: ${JSON.stringify(first.nightly_metadata)} -->\n`};
  assert.equal(selectWire('2.0.0', [wire], true)?.tag, first.tag_name);
  assert.equal(selectWire('2.0.0', [{...wire, body: ''}], true), null);
  assert.equal(selectWire('2.0.0', [{...wire, assets: assets}], true), null);
  for (const changed of [{source_commit:'c'.repeat(40)}, {nightly_sequence:20261022}, {version:'2.0.1'}]) {
    const metadata = {...first.nightly_metadata, ...changed};
    assert.equal(validNightlyMetadata(first.tag_name!, metadata), false);
    assert.equal(selectWire('2.0.0', [{...wire, body:`<!-- nightly-identity: ${JSON.stringify(metadata)} -->\n`}], true), null);
  }
  for (const invalid of [revisedNightly('2026-02-30',1), revisedNightly('2026-10-22',0), revisedNightly('2026-10-22',1000)]) {
    assert.equal(validNightlyMetadata(invalid.tag_name!, invalid.nightly_metadata), false);
    assert.equal(selectAvailableUpdate('2.0.0', [invalid], true), null);
  }
});

test('ARBS-H R1a: only arbs-h-<version>-setup.exe of the same tag notifies on Windows', () => {
  assert.equal(windowsSetupAsset('v0.2.0'), 'arbs-h-0.2.0-setup.exe');
  assert.equal(windowsSetupAsset('0.2.0'), 'arbs-h-0.2.0-setup.exe');
  const withAsset = (tag: string, name: string): UpdateRelease => ({
    tag_name: tag, draft: false, prerelease: false, assets: [{ name, state: 'uploaded', size: 100 }],
  });
  assert.equal(selectWireUpdate('0.1.0', [withAsset('v0.2.0', 'arbs-h-0.2.0-setup.exe')], false)?.tag, '0.2.0');
  for (const name of ['VibepolloSetup.exe', 'VibepolloSetup-v0.2.0.exe', 'VibepolloSetup-0.2.0.exe',
    'arbs-h-0.1.9-setup.exe', 'arbs-h-v0.2.0-setup.exe', 'ARBS-H-0.2.0-setup.exe', 'arbs-h-0.2.0-portable.zip'])
    assert.equal(selectWireUpdate('0.1.0', [withAsset('v0.2.0', name)], false), null, name);
  // A higher-numbered Vibepollo release must never be offered to ARBS-H.
  assert.equal(selectWireUpdate('0.1.0', [withAsset('v2.20.0', 'VibepolloSetup.exe')], true), null);
});
test('ARBS-H R1a: release links point to arbs-project/arbs-h, organization case-insensitive', () => {
  assert.equal(RELEASES_PAGE, 'https://github.com/arbs-project/arbs-h/releases');
  assert.equal(RELEASES_API, 'https://api.github.com/repos/arbs-project/arbs-h/releases');
  assert.equal(isReleasePageUrl('https://github.com/arbs-project/arbs-h/releases/tag/v0.1.0'), true);
  assert.equal(isReleasePageUrl('https://github.com/ARBS-project/arbs-h/releases/tag/v0.1.0'), true);
  assert.equal(isReleasePageUrl('https://github.com/Nonary/Vibepollo/releases/tag/v2.20.0'), false);
  assert.equal(isReleasePageUrl('https://github.com/arbs-project/arbs-h/releases'), false);
  assert.equal(isReleasePageUrl('https://github.com/arbs-project/arbs-h-evil/releases/tag/x'), false);
  assert.equal(isReleasePageUrl(undefined), false);
});
test('ARBS-H R1a: dismissed updates use the arbs-h key, not the Vibepollo key', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  values.set('vibepollo-dismissed-updates', JSON.stringify(['v0.2.0']));
  assert.equal(dismissedUpdate(storage, 'v0.2.0'), false);
  dismissUpdate(storage, 'v0.2.0');
  assert.deepEqual([...values.keys()].sort(), ['arbs-h-dismissed-updates', 'vibepollo-dismissed-updates']);
  assert.equal(dismissedUpdate(storage, 'v0.2.0'), true);
});
