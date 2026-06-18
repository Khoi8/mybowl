/**
 * Build the per-throw `pinState` array for a frame from its pin-COUNTS.
 *
 * RN-free pure helper (no react-native/expo imports) so it is unit-testable in
 * the root Vitest run.
 *
 * `pinState[i]` is a 10-bit mask of pins STANDING **before** throw `i` (bit `p`
 * set ⇒ pin `p+1` is standing). The schema (S5) stores this so pin-leave
 * heatmaps and split detection (S1) can read a real standing mask.
 *
 * IMPORTANT approximation: this slice records pin *counts* only — there is no
 * per-pin selection UI yet (that arrives with richer entry / ball tagging in a
 * later slice). With only counts we cannot know *which* physical pins remain, so
 * we encode "N pins standing" as the N lowest bits set. The COUNT is exact (so
 * strike/spare/open math and per-throw pin deltas are correct); the specific pin
 * identities are a placeholder until per-pin tagging lands. Downstream split
 * naming, which needs exact identities, simply won't fire on these masks — that
 * is intentional and better than fabricating positions.
 *
 *   - Frames 1-9: 10 standing before throw 1; (10 - first) standing before throw 2.
 *   - Frame 10: the rack resets after a strike or a spare, so a fill ball sees a
 *     full rack again; otherwise the second/third ball sees the remaining pins.
 */

const ALL_TEN = 10;

/** Mask with the `count` lowest bits set (count clamped to 0..10). */
function maskForCount(count: number): number {
  const n = Math.max(0, Math.min(ALL_TEN, count));
  return (1 << n) - 1;
}

/**
 * Standing-before-throw masks for one frame's `throws`, in throw order.
 *
 * @param isTenth whether this is the 10th frame (rack-reset semantics differ).
 */
export function buildPinState(throws: number[], isTenth: boolean): number[] {
  const masks: number[] = [];
  let standing = ALL_TEN;

  for (let i = 0; i < throws.length; i++) {
    const pins = throws[i] ?? 0;
    masks.push(maskForCount(standing));

    if (isTenth && standing - pins <= 0) {
      // Cleared the rack (strike, or spare-completing ball, or a fill strike):
      // the next ball in the 10th faces a fresh full rack.
      standing = ALL_TEN;
    } else {
      standing -= pins;
    }
  }

  return masks;
}
