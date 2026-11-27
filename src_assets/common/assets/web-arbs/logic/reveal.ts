// ARBS-H 0.3.1 (H031 F1): "보기(누르는 동안)" state, docs/analysis/H031.md §1-2.
// Pure function so scripts/reveal.test.ts can check every input. The component (components/HoldReveal.vue) captures the
// pointer on press, so moving off the button while still pressing keeps the value shown; only letting go hides it.
// Before 0.3.1 the address getting wider pushed the button out from under the pointer, and pointerleave hid it at once.

export type RevealEvent =
  | { type: 'down'; pointerType: string; button: number }
  | { type: 'up' }
  | { type: 'cancel' }
  | { type: 'lost' }
  | { type: 'blur' }
  | { type: 'hidden' }
  | { type: 'keydown'; key: string; repeat: boolean }
  | { type: 'keyup'; key: string };

/** Keys that show the value while held (and hide it when let go). Escape hides it too. */
export const HOLD_KEYS: readonly string[] = [' ', 'Enter', 'Spacebar'];

/**
 * Next "shown" state. Mouse: main (left) button only; touch and pen: any contact. Hidden again on pointer up / cancel /
 * lost capture, window or button blur, the page going to the background, and on letting go of Space / Enter or
 * pressing Escape. Other keys and key repeats change nothing.
 */
export function nextReveal(shown: boolean, ev: RevealEvent): boolean {
  switch (ev.type) {
    case 'down':
      if (ev.pointerType === 'mouse') return ev.button === 0 ? true : shown;
      return ev.pointerType === 'touch' || ev.pointerType === 'pen' || ev.pointerType === '' ? true : shown;
    case 'up':
    case 'cancel':
    case 'lost':
    case 'blur':
    case 'hidden':
      return false;
    case 'keydown':
      if (ev.key === 'Escape') return false;
      if (HOLD_KEYS.includes(ev.key)) return ev.repeat ? shown : true;
      return shown;
    case 'keyup':
      return HOLD_KEYS.includes(ev.key) || ev.key === 'Escape' ? false : shown;
  }
  return shown;
}
