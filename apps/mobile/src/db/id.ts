/**
 * Client-side, time-sortable UUIDv7 generator (RFC 9562).
 *
 * Lives in `db/`, NOT `domain/`: id generation is IMPURE (reads the clock and
 * consumes randomness), so it must not pollute the pure, deterministic domain.
 *
 * Layout (128 bits / 16 bytes):
 *   - bytes 0-5   : 48-bit Unix time in ms, big-endian (most significant first)
 *   - byte 6 high : 4-bit version = 0b0111 (7)
 *   - byte 6-7    : 12 bits random
 *   - byte 8 high : 2-bit variant = 0b10
 *   - bytes 8-15  : 62 bits random
 *
 * Because the timestamp occupies the most-significant bits, the canonical hex
 * string is lexically sortable by creation time.
 *
 * Randomness: uses `globalThis.crypto.getRandomValues`, available in Node >= 20
 * and in browsers. React Native does NOT ship this by default — the app entry
 * point must import a polyfill (e.g. `react-native-get-random-values`) once,
 * before any id is generated. That import is a documented runtime requirement,
 * not scaffolded here. We deliberately do NOT import `node:crypto`, which would
 * break React Native and isn't portable.
 */

const HEX_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Minimal shape we rely on from the Web Crypto API. We declare it locally rather
 * than depending on DOM lib types, since the typecheck tsconfig uses `lib: ES2022`
 * with `types: []` (no DOM) to keep the build lean and portable.
 */
interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** Fill `bytes` with cryptographically-strong random values. */
function fillRandom(bytes: Uint8Array): void {
  const cryptoObj = (globalThis as { crypto?: RandomSource }).crypto;
  if (cryptoObj === undefined || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is unavailable. On React Native, import ' +
        '"react-native-get-random-values" at your app entry point before generating ids.',
    );
  }
  cryptoObj.getRandomValues(bytes);
}

/** Render 16 bytes as a canonical 8-4-4-4-12 lowercase-hex UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 16; i++) {
    // Non-null assertion-free: index access is `number | undefined` under
    // noUncheckedIndexedAccess, so coalesce defensively (i is always in range).
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a UUIDv7 for an explicit Unix-millisecond timestamp.
 *
 * Exported primarily for deterministic testing of the time-ordering property;
 * production code should call {@link uuidv7}, which supplies `Date.now()`.
 */
export function uuidv7At(ms: number): string {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);

  // 48-bit timestamp, big-endian (most significant byte first) into bytes 0-5.
  // Use a non-negative integer; bit-ops are 32-bit so split hi/lo carefully.
  const timestamp = Math.max(0, Math.floor(ms));
  const tsHi = Math.floor(timestamp / 0x1_0000_0000); // upper 16 bits
  const tsLo = timestamp % 0x1_0000_0000; // lower 32 bits
  bytes[0] = (tsHi >>> 8) & 0xff;
  bytes[1] = tsHi & 0xff;
  bytes[2] = (tsLo >>> 24) & 0xff;
  bytes[3] = (tsLo >>> 16) & 0xff;
  bytes[4] = (tsLo >>> 8) & 0xff;
  bytes[5] = tsLo & 0xff;

  // Version 7 in the high nibble of byte 6; keep the random low nibble.
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  // Variant 0b10 in the high bits of byte 8; keep the random low 6 bits.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  return bytesToUuid(bytes);
}

/** Generate a new time-sortable UUIDv7 stamped with the current time. */
export function uuidv7(): string {
  return uuidv7At(Date.now());
}

/**
 * Validate that `s` is a canonical lowercase UUID whose version nibble is 7 and
 * whose variant bits are 0b10 (i.e. the 4th-group leading nibble is 8, 9, a, or b).
 */
export function isUuidV7(s: string): boolean {
  if (!HEX_SHAPE.test(s)) {
    return false;
  }
  // s[14] = version nibble; s[19] = variant nibble. Shape regex guarantees both exist.
  const versionChar = s[14];
  const variantChar = s[19];
  return versionChar === '7' && variantChar !== undefined && '89ab'.includes(variantChar);
}
