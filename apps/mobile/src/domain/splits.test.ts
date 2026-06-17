import { describe, it, expect } from 'vitest';
import {
  RECOGNIZED_SPLITS,
  isSplit,
  splitName,
  isSinglePinLeave,
  maskFromPins,
  pinsFromMask,
} from './splits';

describe('maskFromPins / pinsFromMask', () => {
  it('round-trips pin sets', () => {
    const cases = [
      [],
      [1],
      [7, 10],
      [4, 6, 7, 10],
      [1, 2, 3, 10],
      [2, 4, 5, 8, 6, 9, 1, 3, 7, 10],
    ];
    for (const pins of cases) {
      const sorted = [...pins].sort((a, b) => a - b);
      expect(pinsFromMask(maskFromPins(pins))).toEqual(sorted);
    }
  });

  it('uses the documented bit convention (pin i => bit i-1)', () => {
    expect(maskFromPins([1])).toBe(1); // bit 0
    expect(maskFromPins([7])).toBe(64); // bit 6
    expect(maskFromPins([10])).toBe(512); // bit 9
    expect(maskFromPins([7, 10])).toBe(64 + 512);
  });

  it('pinsFromMask returns pins in ascending order', () => {
    expect(pinsFromMask(maskFromPins([10, 4, 7, 6]))).toEqual([4, 6, 7, 10]);
  });
});

describe('isSplit — recognized splits', () => {
  it('classifies the 7-10 split', () => {
    expect(isSplit(maskFromPins([7, 10]))).toBe(true);
    expect(splitName(maskFromPins([7, 10]))).toBe('7-10');
  });

  it('classifies the 4-6-7-10 big four', () => {
    expect(isSplit(maskFromPins([4, 6, 7, 10]))).toBe(true);
    expect(splitName(maskFromPins([4, 6, 7, 10]))).toBe('4-6-7-10');
  });

  it('classifies baby splits 5-7, 5-10, 3-10, 2-7', () => {
    expect(isSplit(maskFromPins([5, 7]))).toBe(true);
    expect(splitName(maskFromPins([5, 7]))).toBe('5-7');
    expect(isSplit(maskFromPins([5, 10]))).toBe(true);
    expect(splitName(maskFromPins([5, 10]))).toBe('5-10');
    expect(isSplit(maskFromPins([3, 10]))).toBe(true);
    expect(splitName(maskFromPins([3, 10]))).toBe('3-10');
    expect(isSplit(maskFromPins([2, 7]))).toBe(true);
    expect(splitName(maskFromPins([2, 7]))).toBe('2-7');
  });

  it('classifies the greek church / big five (4-6-7-9-10)', () => {
    expect(isSplit(maskFromPins([4, 6, 7, 9, 10]))).toBe(true);
    expect(splitName(maskFromPins([4, 6, 7, 9, 10]))).toBe('4-6-7-9-10');
  });
});

describe('isSplit — headpin and non-splits', () => {
  it('is never a split when the headpin (pin 1) is standing', () => {
    // pin 1 plus a gapped-looking leave must still be rejected.
    expect(isSplit(maskFromPins([1, 7, 10]))).toBe(false);
    expect(splitName(maskFromPins([1, 7, 10]))).toBeNull();
    expect(isSplit(maskFromPins([1, 5]))).toBe(false);
  });

  it('rejects adjacent no-gap leaves with the headpin down (not recognized splits)', () => {
    // Adjacent pairs have no downed pin between them, so they are open leaves,
    // not splits (CLAUDE.md §7: a split is a *gapped* leave).
    for (const pair of [
      [2, 3], // bucket-adjacent
      [4, 5], // adjacent on the middle row
      [5, 6], // adjacent on the middle row
      [9, 10], // adjacent on the back row
    ]) {
      expect(isSplit(maskFromPins(pair))).toBe(false);
      expect(splitName(maskFromPins(pair))).toBeNull();
    }
  });

  it('rejects the full rack (all ten standing) and the empty mask (strike)', () => {
    expect(isSplit(maskFromPins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(false);
    expect(splitName(maskFromPins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(isSplit(0)).toBe(false);
    expect(splitName(0)).toBeNull();
  });
});

describe('isSinglePinLeave', () => {
  it('is true for exactly one pin standing (10-pin, 7-pin)', () => {
    expect(isSinglePinLeave(maskFromPins([10]))).toBe(true);
    expect(isSinglePinLeave(maskFromPins([7]))).toBe(true);
    expect(isSinglePinLeave(maskFromPins([1]))).toBe(true);
  });

  it('is false for zero pins (strike) and for multi-pin leaves', () => {
    expect(isSinglePinLeave(0)).toBe(false);
    expect(isSinglePinLeave(maskFromPins([7, 10]))).toBe(false);
    expect(isSinglePinLeave(maskFromPins([4, 6, 7, 10]))).toBe(false);
  });

  it('single-pin leaves are never splits', () => {
    expect(isSplit(maskFromPins([10]))).toBe(false);
    expect(isSplit(maskFromPins([7]))).toBe(false);
  });
});

describe('RECOGNIZED_SPLITS table integrity', () => {
  it('every recognized split has the headpin (pin 1) down', () => {
    for (const entry of RECOGNIZED_SPLITS) {
      expect(entry.mask & maskFromPins([1])).toBe(0);
    }
  });

  it('every multi-pin name is ascending pins joined with "-"', () => {
    for (const entry of RECOGNIZED_SPLITS) {
      const expected = pinsFromMask(entry.mask).join('-');
      expect(entry.name).toBe(expected);
    }
  });

  it('has unique masks', () => {
    const masks = RECOGNIZED_SPLITS.map((e) => e.mask);
    expect(new Set(masks).size).toBe(masks.length);
  });

  it('classifies every table entry as a split via splitName', () => {
    for (const entry of RECOGNIZED_SPLITS) {
      expect(isSplit(entry.mask)).toBe(true);
      expect(splitName(entry.mask)).toBe(entry.name);
    }
  });
});
