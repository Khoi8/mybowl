/**
 * End-to-end tests for the solo-stats feature compute (`loadSoloStats`):
 * seed real rows via the S7 repos → run them through the S8 read-models → the
 * pure S2 domain, and assert `loadSoloStats` returns the SAME numbers as calling
 * `computeSeriesStats` / `aggregatePinLeaves` directly on the same data.
 *
 * Also pins the "stats are derived, never stored" invariant: the only schema
 * tables are the entity tables (no `*stats*` table), and `loadSoloStats` is a
 * pure read (it writes nothing — re-reading yields identical output).
 */

import { describe, expect, it } from 'vitest';

import { loadAllGamesForPlayer, loadAllLeavesForPlayer } from '../../db/readmodels';
import { aggregatePinLeaves, computeSeriesStats } from '../../domain/stats';
import { scoreGame } from '../../domain/scoring';
import {
  createGameWithFrames,
  createPlayer,
  type GameFrameInput,
} from '../../db/repositories';
import { users } from '../../db/schema';
import { createMemoryDb, type Db } from '../../db/testing/memoryDb';
import { loadSoloStats } from './loadSoloStats';

const FULL_RACK = 0b1111111111; // all 10 pins standing

function newUser(db: Db): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable: user insert returned no row');
  return user.id;
}

/** Perfect 300: frames 1-9 = [10], frame 10 = [10,10,10]. */
function perfectGameFrames(): GameFrameInput[] {
  const out: GameFrameInput[] = [];
  for (let n = 1; n <= 9; n++) {
    out.push({ frameNo: n, throws: [10], ballIdPerThrow: [null], pinState: [FULL_RACK] });
  }
  out.push({
    frameNo: 10,
    throws: [10, 10, 10],
    ballIdPerThrow: [null, null, null],
    pinState: [FULL_RACK, FULL_RACK, FULL_RACK],
  });
  return out;
}

/**
 * An all-open game: every frame [3, 4] => 7 pins/frame => 70 total. The leave
 * after the first ball is pin 10 standing only (bit 9) — a single-pin leave
 * that is NOT converted, so split=0 and single-pin attempts accrue.
 */
function openGameFrames(): GameFrameInput[] {
  const leave = 0b1000000000; // pin 10 only
  const out: GameFrameInput[] = [];
  for (let n = 1; n <= 10; n++) {
    out.push({
      frameNo: n,
      throws: [3, 4],
      ballIdPerThrow: [null, null],
      pinState: [FULL_RACK, leave],
    });
  }
  return out;
}

describe('loadSoloStats (rows → read-models → domain)', () => {
  it('matches direct domain calls and spot-checks concrete values', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });

    // Two known games: a perfect 300, then an all-open 70.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-18' },
      openGameFrames(),
    );

    const result = loadSoloStats(db, self.id);

    // Independently recompute from the same read-model output.
    const games = loadAllGamesForPlayer(db, self.id);
    const leaves = loadAllLeavesForPlayer(db, self.id);
    const expectedSeries = computeSeriesStats(games, leaves);
    const expectedHeatmap = aggregatePinLeaves(
      games.map((frames, i) => ({ frames, leaves: leaves[i] ?? [] })),
    );

    expect(result.series).toEqual(expectedSeries);
    expect(result.heatmap).toEqual(expectedHeatmap);

    // Concrete spot-checks (sanity that the chain is real, not just self-consistent).
    expect(scoreGame(games[0] ?? []).total).toBe(300);
    expect(scoreGame(games[1] ?? []).total).toBe(70);
    expect(result.series.gameCount).toBe(2);
    expect(result.series.average).toBe(185); // (300 + 70) / 2
    expect(result.series.highGame).toBe(300);
    expect(result.series.highSeries).toBe(370); // series total = 300 + 70
    expect(result.series.cleanGameCount).toBe(1); // perfect game only
    // The open game left pin 10 standing in all 10 frames; the perfect game's
    // frame-10 leave is a full fresh rack (strike), contributing all pins once.
    expect(result.heatmap[10]).toBe(11); // 10 (open) + 1 (perfect frame-10 rack)
    expect(result.heatmap[1]).toBe(1); // only the perfect game's frame-10 rack
  });

  it('empty history => null/0 series fields, zeroed heatmap, no NaN, no throw', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });

    const result = loadSoloStats(db, self.id);

    expect(result.series.gameCount).toBe(0);
    expect(result.series.average).toBeNull();
    expect(result.series.highGame).toBeNull();
    expect(result.series.highSeries).toBeNull();
    expect(result.series.strikePct).toBeNull();
    expect(result.series.spareConversionPct).toBeNull();
    expect(result.series.splitConversionPct).toBeNull();
    expect(result.series.singlePinSparePct).toBeNull();
    expect(result.series.cleanGameCount).toBe(0);
    // No NaN anywhere in the numeric series fields.
    for (const v of Object.values(result.series)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
    // Heatmap is a complete, all-zero 1-10 map.
    for (let pin = 1; pin <= 10; pin++) expect(result.heatmap[pin]).toBe(0);
  });

  it('only reads — no stats are persisted (repeat call is identical, no *stats* table)', () => {
    const { db, sqlite } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );

    const first = loadSoloStats(db, self.id);
    const second = loadSoloStats(db, self.id);
    expect(second).toEqual(first); // pure read: recompute is deterministic

    // There is no derived-stats table in the schema (CLAUDE.md §5).
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.some((t) => /stat/i.test(t.name))).toBe(false);
  });
});
