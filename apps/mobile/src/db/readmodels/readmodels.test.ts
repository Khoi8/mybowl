/**
 * Integration tests for the S8 read-model adapters: seed realistic rows with
 * the S7 repos, run them through the adapters, and feed the adapter OUTPUT
 * straight into the pure S2/S3 domain — asserting the end-to-end numbers match
 * hand-computed expectations. This proves the domain consumes adapter output
 * unchanged (rows → adapter → domain).
 */

import { describe, expect, it } from 'vitest';

import { headToHead, withWithout } from '../../domain/headtohead';
import { scoreGame } from '../../domain/scoring';
import { computeGameStats } from '../../domain/stats';
import {
  createGameWithFrames,
  createPlayer,
  createSession,
  type GameFrameInput,
} from '../repositories';
import { users } from '../schema';
import { createMemoryDb, type Db } from '../testing/memoryDb';
import {
  loadAllGamesForPlayer,
  loadGameFrames,
  loadH2HSessions,
  loadLeaveMasks,
  loadSeriesForPlayer,
  loadWithWithout,
} from './index';

// A full mask of all 10 pins standing (a fresh rack). bit i => pin i+1.
const FULL_RACK = 0b1111111111; // 1023

/** Build 10 identical open frames from a two-throw shape, e.g. [3, 4]. */
function openGameFrames(a: number, b: number): GameFrameInput[] {
  const standingAfterFirst = FULL_RACK & ~knockMask(a); // crude: not pin-accurate, just a nonzero leave
  const out: GameFrameInput[] = [];
  for (let n = 1; n <= 10; n++) {
    out.push({
      frameNo: n,
      throws: [a, b],
      ballIdPerThrow: [null, null],
      // pinState: [before throw 1 = full rack, before throw 2 = leave after first ball]
      pinState: [FULL_RACK, standingAfterFirst],
    });
  }
  return out;
}

/** A naive "first `k` pins down" mask — enough to produce a deterministic leave. */
function knockMask(k: number): number {
  let m = 0;
  for (let i = 0; i < k; i++) m |= 1 << i;
  return m;
}

/** All-strike perfect game: frames 1-9 = [10], frame 10 = [10,10,10]. */
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

function newUser(db: Db): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable: user insert returned no row');
  return user.id;
}

describe('loadGameFrames / loadLeaveMasks', () => {
  it('reconstructs the exact frames inserted and scores them via the domain', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });

    const { game } = createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );

    const frames = loadGameFrames(db, game.id);
    expect(frames).toEqual([
      [10],
      [10],
      [10],
      [10],
      [10],
      [10],
      [10],
      [10],
      [10],
      [10, 10, 10],
    ]);
    // End-to-end: rows → adapter → scoreGame.
    expect(scoreGame(frames).total).toBe(300);
    expect(scoreGame(frames).isComplete).toBe(true);
  });

  it('surfaces pinState[1] (rack facing throw 2) as the per-frame leave mask', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });

    // Frame 1: open with an explicit leave; frame 2: strike (no second throw).
    const { game } = createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      [
        {
          frameNo: 1,
          throws: [7, 2],
          ballIdPerThrow: [null, null],
          pinState: [FULL_RACK, 0b1000000000], // before throw 2: pin 10 standing
        },
        {
          frameNo: 2,
          throws: [10],
          ballIdPerThrow: [null],
          pinState: [FULL_RACK], // strike: only one pinState entry
        },
      ],
    );

    const masks = loadLeaveMasks(db, game.id);
    expect(masks).toEqual([0b1000000000, 0]); // frame1 leave surfaced; strike => 0
  });

  it('yields 0 for frames with <2 pinState entries and feeds into computeGameStats', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });

    const { game } = createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );

    const frames = loadGameFrames(db, game.id);
    const leaves = loadLeaveMasks(db, game.id);
    // Frames 1-9 are single-throw strikes (no pinState[1]) => 0. Frame 10 here
    // is strike/strike/strike, so the recorded pinState[1] is a fresh full rack;
    // the adapter surfaces it faithfully (a strike has no spare/leave to convert,
    // so this does not pollute split / single-pin stats).
    expect(leaves.slice(0, 9).every((m) => m === 0)).toBe(true);
    expect(leaves[9]).toBe(FULL_RACK);

    const stats = computeGameStats(frames, leaves);
    expect(stats.score).toBe(300);
    expect(stats.strikePct).toBe(100);
    expect(stats.isCleanGame).toBe(true);
  });

  it('returns [] for a game with no frames; domain scores it as 0', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const { game } = createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      [],
    );

    expect(loadGameFrames(db, game.id)).toEqual([]);
    expect(loadLeaveMasks(db, game.id)).toEqual([]);
    expect(scoreGame(loadGameFrames(db, game.id)).total).toBe(0);
  });
});

describe('loadSeriesForPlayer / loadAllGamesForPlayer', () => {
  it("returns a player's session games in insertion (UUIDv7) order", () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const session = createSession(db, {
      ownerUserId,
      date: '2026-06-17',
      isGroup: false,
    });

    // Game 1 = perfect 300; game 2 = open [3,4] => 70.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(3, 4),
    );

    const series = loadSeriesForPlayer(db, session.id, self.id);
    expect(series).toHaveLength(2);
    expect(scoreGame(series[0] ?? []).total).toBe(300); // first inserted first
    expect(scoreGame(series[1] ?? []).total).toBe(70);
  });

  it('loadAllGamesForPlayer spans sessions and includes a null-session solo game', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const session = createSession(db, { ownerUserId, date: '2026-06-17' });

    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      perfectGameFrames(),
    );
    // Solo game, sessionId null.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-18' },
      openGameFrames(3, 4),
    );

    const all = loadAllGamesForPlayer(db, self.id);
    expect(all).toHaveLength(2);
    const scores = all.map((g) => scoreGame(g).total).sort((a, b) => a - b);
    expect(scores).toEqual([70, 300]);
  });
});

describe('loadH2HSessions (rows → adapter → headToHead)', () => {
  it('pairs by order across a shared session and tallies W-L-T + margin', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' }); // guest, userId null
    const session = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });

    // Self game 1 = 300, game 2 = open [3,4] => 70.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(3, 4),
    );
    // Opponent game 1 = open [2,2] => 40, game 2 = open [4,4] => 80.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(2, 2),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(4, 4),
    );

    const views = loadH2HSessions(db, self.id, mike.id);
    expect(views).toHaveLength(1);
    const view = views[0];
    if (view === undefined) throw new Error('unreachable');
    expect(view.sessionId).toBe(session.id);

    const record = headToHead(views);
    // Pair 1: 300 vs 40 => self win, margin +260.
    // Pair 2: 70  vs 80 => self loss, margin -10.
    expect(record.wins).toBe(1);
    expect(record.losses).toBe(1);
    expect(record.ties).toBe(0);
    expect(record.gamesPaired).toBe(2);
    expect(record.avgMargin).toBe((260 + -10) / 2); // 125
    expect(record.selfAvg).toBe((300 + 70) / 2); // 185
    expect(record.opponentAvg).toBe((40 + 80) / 2); // 60
  });

  it('drops the unpaired trailing game when counts are unequal', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });
    const session = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });

    // Self bowls 2, opponent bowls 1.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(3, 4),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(2, 2),
    );

    const record = headToHead(loadH2HSessions(db, self.id, mike.id));
    expect(record.gamesPaired).toBe(1); // only pair 1 compared
    expect(record.wins).toBe(1);
    expect(record.avgMargin).toBe(260); // 300 - 40
  });

  it('a solo game (sessionId null) is NOT a shared session', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });

    // Both players have solo (null-session) games — but they share NO session.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17' },
      openGameFrames(2, 2),
    );

    expect(loadH2HSessions(db, self.id, mike.id)).toEqual([]);
    const record = headToHead(loadH2HSessions(db, self.id, mike.id));
    expect(record.gamesPaired).toBe(0);
    expect(record.avgMargin).toBeNull();
    expect(record.selfAvg).toBeNull();
  });

  it('no shared data => empty views, sane null/zero domain output (no throw)', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });

    expect(loadH2HSessions(db, self.id, mike.id)).toEqual([]);
    const record = headToHead([]);
    expect(record).toMatchObject({
      wins: 0,
      losses: 0,
      ties: 0,
      gamesPaired: 0,
      avgMargin: null,
    });
  });
});

describe('loadWithWithout (rows → adapter → withWithout)', () => {
  it('partitions the self player sessions by opponent presence', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });

    // Session A: opponent present. Self bowls 300, opponent bowls anything.
    const sessionWith = createSession(db, {
      ownerUserId,
      date: '2026-06-17',
      isGroup: true,
    });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: sessionWith.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: sessionWith.id },
      openGameFrames(2, 2),
    );

    // Session B: opponent absent. Self bowls an open 70.
    const sessionWithout = createSession(db, { ownerUserId, date: '2026-06-18' });
    createGameWithFrames(
      db,
      {
        ownerUserId,
        playerId: self.id,
        date: '2026-06-18',
        sessionId: sessionWithout.id,
      },
      openGameFrames(3, 4),
    );

    const views = loadWithWithout(db, self.id, mike.id);
    expect(views).toHaveLength(2);
    const present = views.find((v) => v.opponentPresent);
    const absent = views.find((v) => !v.opponentPresent);
    expect(present?.sessionId).toBe(sessionWith.id);
    expect(absent?.sessionId).toBe(sessionWithout.id);

    const split = withWithout(views);
    expect(split.sessionsWith).toBe(1);
    expect(split.sessionsWithout).toBe(1);
    expect(split.withAvg).toBe(300);
    expect(split.withoutAvg).toBe(70);
  });

  it('empty => sane null output (no throw)', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });

    expect(loadWithWithout(db, self.id, mike.id)).toEqual([]);
    const split = withWithout([]);
    expect(split.withAvg).toBeNull();
    expect(split.withoutAvg).toBeNull();
    expect(split.sessionsWith).toBe(0);
    expect(split.sessionsWithout).toBe(0);
  });
});
