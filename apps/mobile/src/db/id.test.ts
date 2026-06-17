import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidv7, uuidv7At } from './id';

/** Canonical 8-4-4-4-12 lowercase-hex UUID shape (any version/variant). */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a canonical-shaped string that passes isUuidV7', () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_SHAPE);
    expect(isUuidV7(id)).toBe(true);
  });

  it('sets the version nibble to 7', () => {
    const id = uuidv7();
    // The 15th hex char (1st char of the 3rd group) is the version nibble.
    expect(id[14]).toBe('7');
  });

  it('sets the variant bits to 0b10 (first char of the 4th group in {8,9,a,b})', () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      const variantChar = id[19];
      expect(variantChar).toBeDefined();
      expect('89ab').toContain(variantChar as string);
    }
  });

  it('encodes the given timestamp in the first 48 bits (big-endian)', () => {
    const ms = 0x0123456789ab;
    const id = uuidv7At(ms);
    // First 12 hex chars = 48-bit timestamp, big-endian, most significant first.
    const tsHex = id.replace(/-/g, '').slice(0, 12);
    expect(tsHex).toBe('0123456789ab');
  });

  it('is monotonic across increasing timestamps (lexical sort matches time order)', () => {
    const ids = [
      uuidv7At(1_000),
      uuidv7At(2_000),
      uuidv7At(3_000),
      uuidv7At(1_700_000_000_000),
      uuidv7At(1_700_000_000_001),
    ];
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('a smaller ms prefix sorts before a larger one regardless of random tail', () => {
    for (let i = 0; i < 50; i++) {
      const earlier = uuidv7At(1_000);
      const later = uuidv7At(2_000);
      expect(earlier < later).toBe(true);
    }
  });

  it('a batch generated in a non-decreasing-time loop sorts to its generation order', () => {
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      ids.push(uuidv7At(base + i));
    }
    expect([...ids].sort()).toEqual(ids);
  });

  it('generates unique ids over a large batch (no collisions)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      set.add(uuidv7());
    }
    expect(set.size).toBe(10_000);
  });
});

describe('isUuidV7', () => {
  it('accepts a freshly generated v7 id', () => {
    expect(isUuidV7(uuidv7())).toBe(true);
    expect(isUuidV7(uuidv7At(0))).toBe(true);
  });

  it('rejects a v4 UUID (wrong version nibble)', () => {
    expect(isUuidV7('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(false);
  });

  it('rejects a string with the v7 shape but a wrong variant (e.g. variant char 7)', () => {
    expect(isUuidV7('017f22e2-79b0-7cc3-7c44-6d1234567890')).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('017f22e2-79b0-7cc3-98c4')).toBe(false);
    expect(isUuidV7('017f22e279b07cc398c46d1234567890')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isUuidV7('')).toBe(false);
  });

  it('rejects uppercase hex (canonical form is lowercase)', () => {
    const id = uuidv7();
    expect(isUuidV7(id.toUpperCase())).toBe(false);
  });
});
