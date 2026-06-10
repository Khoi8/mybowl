import { describe, it, expect } from 'vitest';
import { validateFrame } from './validation';

describe('validateFrame — frames 1-9', () => {
  it('accepts a normal open frame', () => {
    expect(validateFrame(3, [4, 5]).valid).toBe(true);
  });

  it('accepts a strike as a single throw', () => {
    expect(validateFrame(1, [10]).valid).toBe(true);
  });

  it('accepts a spare', () => {
    expect(validateFrame(5, [7, 3]).valid).toBe(true);
  });

  it('rejects two throws exceeding 10 pins', () => {
    const r = validateFrame(2, [7, 5]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/exceed 10/);
  });

  it('rejects a second throw after a strike', () => {
    expect(validateFrame(2, [10, 3]).valid).toBe(false);
  });

  it('rejects more than two throws', () => {
    expect(validateFrame(2, [3, 3, 3]).valid).toBe(false);
  });

  it('rejects a throw value above 10', () => {
    expect(validateFrame(2, [11]).valid).toBe(false);
  });

  it('rejects a negative throw value', () => {
    expect(validateFrame(2, [-1, 3]).valid).toBe(false);
  });

  it('rejects a non-integer throw value', () => {
    expect(validateFrame(2, [4.5, 3]).valid).toBe(false);
  });

  it('rejects an out-of-range frame number', () => {
    expect(validateFrame(0, [4, 5]).valid).toBe(false);
    expect(validateFrame(11, [4, 5]).valid).toBe(false);
  });

  it('accepts an empty (not-yet-bowled) frame', () => {
    expect(validateFrame(4, []).valid).toBe(true);
  });
});

describe('validateFrame — 10th frame', () => {
  it('accepts two open throws with no fill', () => {
    expect(validateFrame(10, [4, 5]).valid).toBe(true);
  });

  it('accepts a spare plus fill ball', () => {
    expect(validateFrame(10, [7, 3, 9]).valid).toBe(true);
  });

  it('accepts three strikes', () => {
    expect(validateFrame(10, [10, 10, 10]).valid).toBe(true);
  });

  it('accepts strike then a fresh-rack pair as fill', () => {
    expect(validateFrame(10, [10, 7, 2]).valid).toBe(true);
  });

  it('rejects a fill ball on an open 10th frame', () => {
    const r = validateFrame(10, [4, 5, 3]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/strike or spare/);
  });

  it('rejects first two throws over 10 when first is not a strike', () => {
    expect(validateFrame(10, [7, 5]).valid).toBe(false);
  });

  it('rejects bonus pair over 10 after a strike when pins were not cleared', () => {
    // strike, then 7 + 5 on a fresh rack is impossible
    expect(validateFrame(10, [10, 7, 5]).valid).toBe(false);
  });

  it('rejects more than three throws', () => {
    expect(validateFrame(10, [10, 10, 10, 10]).valid).toBe(false);
  });
});
