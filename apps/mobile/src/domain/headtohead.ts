/**
 * Pure relational ("head-to-head") bowling statistics. NO React Native / Expo /
 * React / Node imports — unit-testable in plain Node and portable.
 *
 * Everything here is DERIVED live from session/game/frame data already on the
 * device; nothing is stored. Game scores come from `scoreGame` (never
 * re-derived) and strike% from `computeSeriesStats` (never re-implemented).
 *
 * Input shapes are intentionally decoupled from DB rows: callers map persisted
 * rows into these pure views. A "game" is the `scoreGame` `number[][]` frame
 * shape (frames of throw pin-counts).
 *
 * Two relational lenses (CLAUDE.md §8):
 *   - "Against" (competitive): pair the self-player's games with an opponent's
 *     games BY ORDER within each shared session; tally W/L/T and margins.
 *   - "With" (does this person elevate my game): partition the self-player's
 *     sessions by whether the opponent was present, and compare averages.
 *
 * The math keys ONLY on game scores — a guest player and a real-account player
 * are treated identically.
 *
 * Ratio convention (project-wide): every ratio/average is `null` when its
 * denominator is 0 — never NaN or Infinity.
 */

import { scoreGame } from './scoring';
import { computeSeriesStats } from './stats';

/**
 * One shared session viewed for head-to-head: the ordered lists of the
 * self-player's games and a single opponent's games within that session.
 */
export interface H2HSessionView {
  sessionId: string;
  selfGames: number[][][];
  opponentGames: number[][][];
}

/**
 * One of the self-player's sessions, flagged by whether a given opponent was
 * present, for the with/without analysis.
 */
export interface SelfSessionView {
  sessionId: string;
  opponentPresent: boolean;
  selfGames: number[][][];
}

export interface HeadToHeadRecord {
  wins: number;
  losses: number;
  ties: number;
  /** Number of by-order game pairs compared across all shared sessions. */
  gamesPaired: number;
  /** Mean of (self - opponent) over paired games; `null` if none paired. */
  avgMargin: number | null;
  /** Mean self game score over paired games only; `null` if none paired. */
  selfAvg: number | null;
  /** Mean opponent game score over paired games only; `null` if none paired. */
  opponentAvg: number | null;
}

export interface WithWithoutSplit {
  /** Mean self game score across sessions where the opponent was present. */
  withAvg: number | null;
  /** Mean self game score across sessions where the opponent was absent. */
  withoutAvg: number | null;
  withStrikePct: number | null;
  withoutStrikePct: number | null;
  sessionsWith: number;
  sessionsWithout: number;
}

/** Mean of a list, or `null` when empty (never NaN). */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/**
 * Competitive ("against") stats vs one opponent across all shared sessions.
 * Games are paired BY ORDER within each session; unpaired trailing games are
 * dropped (they still count toward personal averages elsewhere, not here).
 */
export function headToHead(sessions: H2HSessionView[]): HeadToHeadRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const selfScores: number[] = [];
  const opponentScores: number[] = [];

  for (const session of sessions) {
    const pairCount = Math.min(session.selfGames.length, session.opponentGames.length);
    for (let i = 0; i < pairCount; i++) {
      const selfGame = session.selfGames[i] ?? [];
      const opponentGame = session.opponentGames[i] ?? [];
      const selfScore = scoreGame(selfGame).total;
      const opponentScore = scoreGame(opponentGame).total;
      selfScores.push(selfScore);
      opponentScores.push(opponentScore);
      if (selfScore > opponentScore) wins += 1;
      else if (selfScore < opponentScore) losses += 1;
      else ties += 1;
    }
  }

  const gamesPaired = selfScores.length;
  const margins = selfScores.map((s, i) => s - (opponentScores[i] ?? 0));

  return {
    wins,
    losses,
    ties,
    gamesPaired,
    avgMargin: mean(margins),
    selfAvg: mean(selfScores),
    opponentAvg: mean(opponentScores),
  };
}

/**
 * Count of shared sessions in which a real head-to-head occurred — i.e. both
 * the self-player and the opponent bowled at least one game (so at least one
 * by-order pair exists). Surfaces "you've bowled with X N times" so identity
 * fragmentation (re-creating a contact each visit) is visible.
 */
export function timesBowledWith(sessions: H2HSessionView[]): number {
  let count = 0;
  for (const session of sessions) {
    if (session.selfGames.length > 0 && session.opponentGames.length > 0) {
      count += 1;
    }
  }
  return count;
}

/**
 * Contextual ("with") stats: partition the self-player's sessions by whether
 * the opponent was present, and compare the self-player's averages and strike%
 * across the two partitions. Strike% reuses the solo stats definition via
 * `computeSeriesStats` (leaves are not needed for strike%).
 */
export function withWithout(sessions: SelfSessionView[]): WithWithoutSplit {
  const withScores: number[] = [];
  const withoutScores: number[] = [];
  const withGames: number[][][] = [];
  const withoutGames: number[][][] = [];
  let sessionsWith = 0;
  let sessionsWithout = 0;

  for (const session of sessions) {
    const bucket = session.opponentPresent ? withGames : withoutGames;
    const scores = session.opponentPresent ? withScores : withoutScores;
    if (session.opponentPresent) sessionsWith += 1;
    else sessionsWithout += 1;
    for (const game of session.selfGames) {
      bucket.push(game);
      scores.push(scoreGame(game).total);
    }
  }

  return {
    withAvg: mean(withScores),
    withoutAvg: mean(withoutScores),
    withStrikePct: computeSeriesStats(withGames).strikePct,
    withoutStrikePct: computeSeriesStats(withoutGames).strikePct,
    sessionsWith,
    sessionsWithout,
  };
}
