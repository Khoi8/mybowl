/**
 * Recognized-split classification. NO React Native / Expo / React / Node imports
 * — pure and unit-testable in plain Node.
 *
 * A leave is described by a 10-bit pin mask: bit i (0-indexed) set => pin (i+1)
 * is STANDING. Pins are numbered:
 *
 *        7 8 9 10
 *         4 5 6
 *          2 3
 *           1
 *
 * So pin 1 = bit 0 (value 1), pin 7 = bit 6 (value 64), pin 10 = bit 9 (512).
 *
 * Splits are NOT geometrically inferred — they are a hardcoded lookup of
 * standard recognized splits. Every recognized split requires the headpin
 * (pin 1) to be down; a leave with pin 1 standing is never a split.
 */

/** A 10-bit standing-pin mask (bit i set => pin (i+1) standing). */
export type PinMask = number;

/** Build a mask from a list of standing pin numbers (1-10). */
export function maskFromPins(pins: number[]): PinMask {
  let mask = 0;
  for (const pin of pins) {
    mask |= 1 << (pin - 1);
  }
  return mask;
}

/** Expand a mask into the ascending list of standing pin numbers (1-10). */
export function pinsFromMask(mask: PinMask): number[] {
  const pins: number[] = [];
  for (let pin = 1; pin <= 10; pin++) {
    if (mask & (1 << (pin - 1))) pins.push(pin);
  }
  return pins;
}

/**
 * Standard recognized splits, authored as standing-pin lists. The exported
 * table derives mask + canonical name (ascending pins joined with "-") from
 * each. Every leave below has the headpin down.
 */
const SPLIT_PIN_LISTS: ReadonlyArray<number[]> = [
  [7, 10], // bedposts / "snake eyes"
  [4, 6, 7, 10], // big four
  [4, 7, 10],
  [6, 7, 10],
  [4, 6],
  [7, 9],
  [8, 10],
  [2, 7],
  [3, 10],
  [5, 7],
  [5, 10],
  [4, 6, 7, 9, 10], // greek church / "big five"
  [4, 7, 9, 10],
  [6, 7, 8, 10],
];

/** Hardcoded recognized-split lookup table. */
export const RECOGNIZED_SPLITS: ReadonlyArray<{ mask: PinMask; name: string }> =
  SPLIT_PIN_LISTS.map((pins) => {
    const ascending = [...pins].sort((a, b) => a - b);
    return { mask: maskFromPins(ascending), name: ascending.join('-') };
  });

const SPLIT_NAME_BY_MASK: ReadonlyMap<PinMask, string> = new Map(
  RECOGNIZED_SPLITS.map((entry) => [entry.mask, entry.name]),
);

/**
 * Canonical split label for a leave, or null if it is not a recognized split.
 * Pure table lookup — the headpin-down requirement is already baked into the
 * table, so a leave with pin 1 standing simply won't match.
 */
export function splitName(standingAfterFirst: PinMask): string | null {
  return SPLIT_NAME_BY_MASK.get(standingAfterFirst) ?? null;
}

/** True only for recognized splits (headpin must be down). */
export function isSplit(standingAfterFirst: PinMask): boolean {
  return SPLIT_NAME_BY_MASK.has(standingAfterFirst);
}

/** True when exactly one pin is standing. */
export function isSinglePinLeave(standingAfterFirst: PinMask): boolean {
  return (
    standingAfterFirst !== 0 && (standingAfterFirst & (standingAfterFirst - 1)) === 0
  );
}
