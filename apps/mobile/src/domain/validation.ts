/**
 * Pure entry validation for frame throws. NO React Native / Expo / React /
 * Node imports.
 *
 * Rules enforced:
 *   - every throw is an integer in 0..10;
 *   - frames 1-9: a strike takes one throw; otherwise at most two throws whose
 *     sum may not exceed 10;
 *   - frame 10: at most three throws; the first two may exceed 10 only when the
 *     first is a strike (pins reset); a third throw requires a strike or spare;
 *     a bonus pair thrown at a non-cleared rack may not exceed 10.
 */

const STRIKE_PINS = 10;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const ok = (): ValidationResult => ({ valid: true });
const fail = (reason: string): ValidationResult => ({ valid: false, reason });

export function validateFrame(frameNo: number, throws: number[]): ValidationResult {
  if (!Number.isInteger(frameNo) || frameNo < 1 || frameNo > 10) {
    return fail(`frame number ${frameNo} out of range 1-10`);
  }
  for (const t of throws) {
    if (!Number.isInteger(t)) return fail(`throw value ${t} is not an integer`);
    if (t < 0 || t > STRIKE_PINS) return fail(`throw value ${t} out of range 0-10`);
  }
  return frameNo < 10 ? validateOpenFrame(throws) : validateTenthFrame(throws);
}

function validateOpenFrame(throws: number[]): ValidationResult {
  if (throws.length === 0) return ok();

  const first = throws[0] ?? 0;
  if (first === STRIKE_PINS) {
    if (throws.length > 1) {
      return fail('no second throw allowed after a strike in frames 1-9');
    }
    return ok();
  }

  if (throws.length > 2) return fail('frames 1-9 allow at most two throws');
  if (throws.length === 2 && first + (throws[1] ?? 0) > STRIKE_PINS) {
    return fail('two throws cannot exceed 10 pins in frames 1-9');
  }
  return ok();
}

function validateTenthFrame(throws: number[]): ValidationResult {
  if (throws.length === 0) return ok();
  if (throws.length > 3) return fail('frame 10 allows at most three throws');

  const a = throws[0] ?? 0;
  const b = throws[1] ?? 0;
  const c = throws[2] ?? 0;

  // First two-ball block: pins only reset if the first ball is a strike.
  if (a !== STRIKE_PINS && throws.length >= 2 && a + b > STRIKE_PINS) {
    return fail('first two throws cannot exceed 10 unless the first is a strike');
  }

  if (throws.length === 3) {
    const earnedFill = a === STRIKE_PINS || a + b === STRIKE_PINS;
    if (!earnedFill) return fail('third throw in frame 10 requires a strike or spare');

    // After a strike on ball 1, ball 2 starts a fresh rack. If ball 2 is not
    // itself a strike, ball 3 hits the remaining pins, so b + c may not exceed 10.
    if (a === STRIKE_PINS && b !== STRIKE_PINS && b + c > STRIKE_PINS) {
      return fail('bonus throws cannot exceed 10 unless the pins were cleared');
    }
  }

  return ok();
}
