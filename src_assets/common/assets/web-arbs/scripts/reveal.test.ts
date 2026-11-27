// ARBS-H 0.3.1 (H031 F1): "보기(누르는 동안)" state for mouse, touch, pen and keyboard (logic/reveal.ts), plus static
// checks that every "보기" on the remote access page uses the one component and the component captures the pointer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { nextReveal, type RevealEvent } from '../logic/reveal.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (events: RevealEvent[], start = false) => events.reduce((s, e) => nextReveal(s, e), start);

test('mouse: left button shows while pressed, up hides; right / middle button do nothing', () => {
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 0 }]), true);
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 0 }, { type: 'up' }]), false);
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 2 }]), false);
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 1 }]), false);
  // right click while shown does not change it
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 2 }], true), true);
});

test('touch and pen: any contact shows, up / cancel / lost capture hide', () => {
  for (const pointerType of ['touch', 'pen']) {
    assert.equal(run([{ type: 'down', pointerType, button: 0 }]), true, pointerType);
    assert.equal(run([{ type: 'down', pointerType, button: -1 }]), true, `${pointerType} button -1`);
    for (const end of ['up', 'cancel', 'lost'] as const) {
      assert.equal(run([{ type: 'down', pointerType, button: 0 }, { type: end }]), false, `${pointerType} ${end}`);
    }
  }
});

test('blur and page hidden always hide', () => {
  assert.equal(run([{ type: 'down', pointerType: 'mouse', button: 0 }, { type: 'blur' }]), false);
  assert.equal(run([{ type: 'down', pointerType: 'touch', button: 0 }, { type: 'hidden' }]), false);
  assert.equal(run([{ type: 'keydown', key: ' ', repeat: false }, { type: 'blur' }]), false);
});

test('keyboard: Space / Enter shown while held, repeat ignored, other keys ignored, Escape hides', () => {
  for (const key of [' ', 'Enter']) {
    assert.equal(run([{ type: 'keydown', key, repeat: false }]), true, key);
    assert.equal(run([{ type: 'keydown', key, repeat: false }, { type: 'keydown', key, repeat: true }]), true, `${key} repeat`);
    assert.equal(run([{ type: 'keydown', key, repeat: false }, { type: 'keyup', key }]), false, `${key} up`);
  }
  // a repeat without the first press does not show (focus moved onto the button while the key was held)
  assert.equal(run([{ type: 'keydown', key: ' ', repeat: true }]), false);
  // other keys neither show nor hide (0.3.0 hid on any keyup)
  assert.equal(run([{ type: 'keydown', key: 'a', repeat: false }]), false);
  assert.equal(run([{ type: 'keydown', key: ' ', repeat: false }, { type: 'keyup', key: 'Shift' }]), true);
  assert.equal(run([{ type: 'keydown', key: 'Tab', repeat: false }], true), true);
  assert.equal(run([{ type: 'keydown', key: 'Escape', repeat: false }], true), false);
  assert.equal(run([{ type: 'keyup', key: 'Escape' }], true), false);
});

test('pointer leaving the button is not an event: only letting go hides (F1)', () => {
  // The component has no pointerleave handler; moving off while pressed keeps the value shown until up.
  const vue = readFileSync(join(root, 'components/HoldReveal.vue'), 'utf8');
  assert.doesNotMatch(vue, /pointerleave|pointerout/);
  assert.match(vue, /setPointerCapture\(e\.pointerId\)/);
  assert.match(vue, /@pointerup=/);
  assert.match(vue, /@pointercancel=/);
  assert.match(vue, /@lostpointercapture=/);
  assert.match(vue, /@contextmenu\.prevent/);
  assert.match(vue, /visibilitychange/);
  assert.match(vue, /class="button button--ghost remote__reveal"/);
  const css = readFileSync(join(root, 'styles/base.css'), 'utf8');
  const rule = /\.remote__reveal \{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const p of ['touch-action: none', 'user-select: none', '-webkit-user-select: none', '-webkit-touch-callout: none']) assert.ok(rule.includes(p), p);
  const code = /\.remote__address code \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(code.includes('min-width: 22ch') && code.includes('display: inline-block'), 'fixed address width');
});

test('every "보기" on the remote page is the HoldReveal component (no hand-made pointer handlers left)', () => {
  const view = readFileSync(join(root, 'views/RemoteAccessView.vue'), 'utf8');
  assert.doesNotMatch(view, /data-reveal|@pointerdown|@pointerleave|hold\(/);
  const uses = view.match(/<HoldReveal\b/g) ?? [];
  // 3a tailnet, 3b inside address, 4 tailnet, 4 router outside address, 4 value from it, 4 value from typed address
  assert.equal(uses.length, 6);
});
