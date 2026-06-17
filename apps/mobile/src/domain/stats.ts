/**
 * Pure solo bowling statistics. NO React Native / Expo / React / Node imports —
 * unit-testable in plain Node and portable.
 *
 * All stats are DERIVED live from frame data; nothing here is stored. Scores are
 * obtained via `scoreGame` (never re-derived) and split / single-pin
 * classification reuses `splits.ts` (never re-inferred).
 *
 * A game is `number[][]` (frames of throw pin-counts), matching `scoreGame`.
 * Optional per-frame leave masks (`PinMask`, one per frame) describe the pins
 * left STANDING after the first ball of that frame — i.e. the rack facing the
 * second throw. They drive split / single-pin classification and the pin-leave
 * heatmap. When leaves are absent, split- and single-pin-dependent ratios
 * return `null`.
 *
 * Ratio convention (project-wide): every ratio is `null` when its denominator
 * is 0 — never NaN or Infinity.
 *
 * Frame-10 first-ball opportunity choice (documented & defensible): the 10th
 * frame can present multiple fresh racks. We count each FRESH-RACK ball as a
 * first-ball opportunity: the opening ball always, plus any fill ball that
 * follows a cleared rack (a strike, or the spare's clearing ball). A strike on
 * any fresh-rack ball counts as a strike. The clearing ball of a 10th-frame
 * spare is the second throw of an already-open rack, so it is NOT a fresh-rack
 * opportunity.
 */

import { scoreGame } from './scoring';
import { isSplit, isSinglePinLeave } from './splits';
import type { PinMask } from './splits';

const STRIKE_PINS = 10;
const LAST_FRAME = 10;

export interface GameStats {
  /** Final game score from `scoreGame`. */
  score: number;
  /** strikes / first-ball opportunities; `null` if no opportunities. */
  strikePct: number | null;
  /** spares made / spare attempts; `null` if no attempts. */
  spareConversionPct: number | null;
  /** splits converted / splits faced; `null` if no leaves or none faced. */
  splitConversionPct: number | null;
  /** single-pin spares made / single-pin attempts; `null` if no leaves or none. */
  singlePinSparePct: number | null;
  /** every frame marked (strike or spare) — no open frames. */
  isCleanGame: boolean;

  // Underlying counts, exposed so callers can roll series totals up themselves.
  firstBallCount: number;
  strikeCount: number;
  spareAttempts: number;
  spareConversions: number;
  splitsFaced: number;
  splitsConverted: number;
  singlePinAttempts: number;
  singlePinConversions: number;
}

export interface SeriesStats {
  gameCount: number;
  totalPinfall: number;
  /** mean game score; `null` for an empty series. */
  average: number | null;
  /** highest single game score; `null` for an empty series. */
  highGame: number | null;
  /** total pinfall across the given games (the series total); `null` if empty. */
  highSeries: number | null;
  cleanGameCount: number;
  strikePct: number | null;
  spareConversionPct: number | null;
  splitConversionPct: number | null;
  singlePinSparePct: number | null;
}

/** A ratio as a percentage, or `null` when the denominator is 0. */
function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/** Raw, leaf-level tallies for one game — the building block for rollups. */
interface GameTally {
  firstBallCount: number;
  strikeCount: number;
  spareAttempts: number;
  spareConversions: number;
  splitsFaced: number;
  splitsConverted: number;
  singlePinAttempts: number;
  singlePinConversions: number;
  hasOpenFrame: boolean;
  /** whether leaves were supplied (split/single-pin meaningful). */
  hasLeaves: boolean;
}

function emptyTally(hasLeaves: boolean): GameTally {
  return {
    firstBallCount: 0,
    strikeCount: 0,
    spareAttempts: 0,
    spareConversions: 0,
    splitsFaced: 0,
    splitsConverted: 0,
    singlePinAttempts: 0,
    singlePinConversions: 0,
    hasOpenFrame: false,
    hasLeaves,
  };
}

/**
 * Classify one regular frame (1-9): first-ball opportunity, strike/spare, and
 * (if leaves present) split / single-pin attempt + conversion.
 */
function tallyRegularFrame(
  t: GameTally,
  throws: number[],
  leave: PinMask | undefined,
): void {
  t.firstBallCount += 1;
  const first = throws[0] ?? 0;
  if (first === STRIKE_PINS) {
    t.strikeCount += 1;
    return;
  }
  if (throws.length < 2) {
    // Incomplete/unbowled frame — no spare attempt yet, treat as open.
    t.hasOpenFrame = true;
    return;
  }
  const second = throws[1] ?? 0;
  const made = first + second === STRIKE_PINS;
  // First ball didn't strike and pins remained ⇒ a spare attempt.
  t.spareAttempts += 1;
  if (made) {
    t.spareConversions += 1;
  } else {
    t.hasOpenFrame = true;
  }
  // Splits and single-pin leaves ARE generic spare attempts (counted above)
  // AND are tracked separately here.
  if (leave !== undefined) {
    if (isSplit(leave)) {
      t.splitsFaced += 1;
      if (made) t.splitsConverted += 1;
    } else if (isSinglePinLeave(leave)) {
      t.singlePinAttempts += 1;
      if (made) t.singlePinConversions += 1;
    }
  }
}

/**
 * Classify the 10th frame. Walks fresh racks to count first-ball opportunities
 * and strikes, and treats the opening rack like a regular frame for spare /
 * split / single-pin purposes.
 */
function tallyTenthFrame(
  t: GameTally,
  throws: number[],
  leave: PinMask | undefined,
): void {
  const first = throws[0] ?? 0;
  const second = throws[1] ?? 0;

  // --- spare / split / single-pin on the OPENING rack ---
  if (first !== STRIKE_PINS && throws.length >= 2) {
    const made = first + second === STRIKE_PINS;
    t.spareAttempts += 1;
    if (made) {
      t.spareConversions += 1;
    } else {
      t.hasOpenFrame = true;
    }
    if (leave !== undefined) {
      if (isSplit(leave)) {
        t.splitsFaced += 1;
        if (made) t.splitsConverted += 1;
      } else if (isSinglePinLeave(leave)) {
        t.singlePinAttempts += 1;
        if (made) t.singlePinConversions += 1;
      }
    }
  } else if (first !== STRIKE_PINS && throws.length < 2) {
    // Opening rack not completed ⇒ open.
    t.hasOpenFrame = true;
  }

  // --- fresh-rack first-ball opportunities & strikes ---
  // The opening ball is always a fresh rack. After a cleared rack (strike, or a
  // spare's clearing ball) the next ball is a fresh rack too.
  let pinsStanding = STRIKE_PINS;
  for (let i = 0; i < throws.length; i++) {
    const knocked = throws[i] ?? 0;
    const freshRack = pinsStanding === STRIKE_PINS;
    if (freshRack) {
      t.firstBallCount += 1;
      if (knocked === STRIKE_PINS) t.strikeCount += 1;
    }
    pinsStanding -= knocked;
    if (pinsStanding <= 0) pinsStanding = STRIKE_PINS; // rack cleared ⇒ reset
  }
}

function tallyGame(frames: number[][], leaves?: PinMask[]): GameTally {
  const t = emptyTally(leaves !== undefined);
  // A clean game requires all 10 frames present.
  if (frames.length < LAST_FRAME) t.hasOpenFrame = true;

  for (let f = 0; f < frames.length; f++) {
    const throws = frames[f] ?? [];
    const leave = leaves ? leaves[f] : undefined;
    if (f + 1 < LAST_FRAME) {
      tallyRegularFrame(t, throws, leave);
    } else if (f + 1 === LAST_FRAME) {
      tallyTenthFrame(t, throws, leave);
    }
    // Frames beyond the 10th are ignored (malformed input).
  }
  return t;
}

function statsFromTally(t: GameTally, score: number): GameStats {
  return {
    score,
    strikePct: pct(t.strikeCount, t.firstBallCount),
    spareConversionPct: pct(t.spareConversions, t.spareAttempts),
    splitConversionPct: t.hasLeaves ? pct(t.splitsConverted, t.splitsFaced) : null,
    singlePinSparePct: t.hasLeaves
      ? pct(t.singlePinConversions, t.singlePinAttempts)
      : null,
    isCleanGame: !t.hasOpenFrame,
    firstBallCount: t.firstBallCount,
    strikeCount: t.strikeCount,
    spareAttempts: t.spareAttempts,
    spareConversions: t.spareConversions,
    splitsFaced: t.splitsFaced,
    splitsConverted: t.splitsConverted,
    singlePinAttempts: t.singlePinAttempts,
    singlePinConversions: t.singlePinConversions,
  };
}

/** Compute all solo stats for a single game. */
export function computeGameStats(frames: number[][], leaves?: PinMask[]): GameStats {
  const score = scoreGame(frames).total;
  const tally = tallyGame(frames, leaves);
  return statsFromTally(tally, score);
}

/**
 * Compute series stats for a player's set of games (e.g. one outing).
 *
 * `average` = mean game score. `highGame` = best single game. `highSeries` =
 * the total pinfall across the given games (the series total, not a max over
 * sub-windows). Rate stats are rolled up from the underlying per-game counts.
 * Split / single-pin pcts stay `null` unless leaves are supplied for the games.
 */
export function computeSeriesStats(
  games: number[][][],
  leaves?: PinMask[][],
): SeriesStats {
  let totalPinfall = 0;
  let highGame: number | null = null;
  let cleanGameCount = 0;

  // Roll up raw counts; leaves are meaningful only if supplied for every game.
  const roll = emptyTally(leaves !== undefined && leaves.length >= games.length);

  for (let g = 0; g < games.length; g++) {
    const frames = games[g] ?? [];
    const gameLeaves = leaves ? leaves[g] : undefined;
    const score = scoreGame(frames).total;
    totalPinfall += score;
    if (highGame === null || score > highGame) highGame = score;

    const t = tallyGame(frames, gameLeaves);
    if (!t.hasOpenFrame) cleanGameCount += 1;
    roll.firstBallCount += t.firstBallCount;
    roll.strikeCount += t.strikeCount;
    roll.spareAttempts += t.spareAttempts;
    roll.spareConversions += t.spareConversions;
    roll.splitsFaced += t.splitsFaced;
    roll.splitsConverted += t.splitsConverted;
    roll.singlePinAttempts += t.singlePinAttempts;
    roll.singlePinConversions += t.singlePinConversions;
  }

  const gameCount = games.length;
  return {
    gameCount,
    totalPinfall,
    average: gameCount === 0 ? null : totalPinfall / gameCount,
    highGame,
    highSeries: gameCount === 0 ? null : totalPinfall,
    cleanGameCount,
    strikePct: pct(roll.strikeCount, roll.firstBallCount),
    spareConversionPct: pct(roll.spareConversions, roll.spareAttempts),
    splitConversionPct: roll.hasLeaves
      ? pct(roll.splitsConverted, roll.splitsFaced)
      : null,
    singlePinSparePct: roll.hasLeaves
      ? pct(roll.singlePinConversions, roll.singlePinAttempts)
      : null,
  };
}

/**
 * For each pin 1-10, the count of frames (across all given games) where that
 * pin was left STANDING after the first ball. Drives the pin-leave heatmap.
 * Returns a full 1-10 map (zeros included).
 */
export function aggregatePinLeaves(
  games: { frames: number[][]; leaves: PinMask[] }[],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let pin = 1; pin <= 10; pin++) counts[pin] = 0;

  for (const game of games) {
    for (let f = 0; f < game.leaves.length; f++) {
      const mask = game.leaves[f] ?? 0;
      for (let pin = 1; pin <= 10; pin++) {
        if (mask & (1 << (pin - 1))) {
          counts[pin] = (counts[pin] ?? 0) + 1;
        }
      }
    }
  }
  return counts;
}
