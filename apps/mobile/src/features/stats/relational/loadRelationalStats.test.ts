/**
 * End-to-end tests for the relational-stats feature compute
 * (`loadRelationalStats`): seed real rows via the S7 repos → run them through
 * the S8 read-models → the pure S3 domain, and assert `loadRelationalStats`
 * returns the SAME values as calling `headToHead` / `withWithout` /
 * `timesBowledWith` directly on the same data, with concrete spot values.
 *
 * Also pins the "relational stats are derived, never stored" invariant: zero
 * shared history yields sane zero/null output (no NaN, no throw), and a guest
 * opponent behaves identically to a linked one (the math keys on player ids).
 */

import { describe, expect, it } from 'vitest';

import { headToHead, timesBowledWith, withWithout } from '../../../domain/headtohead';
import { scoreGame } from '../../../domain/scoring';
import { loadH2HSessions, loadWithWithout } from '../../../db/readmodels';
import {
  createGameWithFrames,
  createPlayer,
  createSession,
  type GameFrameInput,
} from '../../../db/repositories';
import { users } from '../../../db/schema';
import { createMemoryDb, type Db } from '../../../db/testing/memoryDb';
import { loadRelationalStats } from './loadRelationalStats';

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

/** 10 identical open frames of [a, b] => 10*(a+b) total. */
function openGameFrames(a: number, b: number): GameFrameInput[] {
  const out: GameFrameInput[] = [];
  for (let n = 1; n <= 10; n++) {
    out.push({
      frameNo: n,
      throws: [a, b],
      ballIdPerThrow: [null, null],
      pinState: [FULL_RACK, FULL_RACK],
    });
  }
  return out;
}

describe('loadRelationalStats (rows → read-models → domain)', () => {
  it('matches direct domain calls and spot-checks concrete values', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' }); // guest, userId null

    // Shared session: self 300 then open 70; opponent open 40 then open 80.
    const shared = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: shared.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: shared.id },
      openGameFrames(3, 4), // 70
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: shared.id },
      openGameFrames(2, 2), // 40
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-17', sessionId: shared.id },
      openGameFrames(4, 4), // 80
    );

    // A second shared session where self bowls 2 but opponent only 1 — the
    // trailing self game is dropped from head-to-head.
    const shared2 = createSession(db, { ownerUserId, date: '2026-06-18', isGroup: true });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-18', sessionId: shared2.id },
      openGameFrames(5, 4), // 90
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-18', sessionId: shared2.id },
      openGameFrames(1, 1), // 20 — trailing, no opponent pair => dropped
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: mike.id, date: '2026-06-18', sessionId: shared2.id },
      openGameFrames(3, 3), // 60
    );

    // A solo (no opponent) session — counts toward with/without "without".
    const soloSession = createSession(db, { ownerUserId, date: '2026-06-19' });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-19', sessionId: soloSession.id },
      openGameFrames(2, 4), // 60
    );

    const result = loadRelationalStats(db, self.id, mike.id);

    // Independently recompute from the same read-model output.
    const h2hViews = loadH2HSessions(db, self.id, mike.id);
    const selfViews = loadWithWithout(db, self.id, mike.id);
    expect(result.record).toEqual(headToHead(h2hViews));
    expect(result.withWithout).toEqual(withWithout(selfViews));
    expect(result.timesBowledWith).toBe(timesBowledWith(h2hViews));

    // Concrete head-to-head spot values across both shared sessions.
    // Session 1 pairs: 300 vs 40 (win, +260), 70 vs 80 (loss, -10).
    // Session 2 pairs: 90 vs 60 (win, +30); trailing self 20 dropped.
    expect(result.record.wins).toBe(2);
    expect(result.record.losses).toBe(1);
    expect(result.record.ties).toBe(0);
    expect(result.record.gamesPaired).toBe(3);
    expect(result.record.avgMargin).toBe((260 + -10 + 30) / 3); // 280/3
    expect(result.record.selfAvg).toBe((300 + 70 + 90) / 3); // 460/3
    expect(result.record.opponentAvg).toBe((40 + 80 + 60) / 3); // 60

    // "Bowled with" headline: both shared sessions had a real head-to-head.
    expect(result.timesBowledWith).toBe(2);

    // With/without: WITH = both shared sessions' self games (300,70,90,20);
    // WITHOUT = the solo session's self game (60).
    expect(result.withWithout.sessionsWith).toBe(2);
    expect(result.withWithout.sessionsWithout).toBe(1);
    expect(result.withWithout.withAvg).toBe((300 + 70 + 90 + 20) / 4); // 120
    expect(result.withWithout.withoutAvg).toBe(60);
  });

  it('a single shared self-300 vs opp-40 session => win, margin +260', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const opp = createPlayer(db, { name: 'Nancy' });

    const session = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
      perfectGameFrames(),
    );
    createGameWithFrames(
      db,
      { ownerUserId, playerId: opp.id, date: '2026-06-17', sessionId: session.id },
      openGameFrames(2, 2), // 40
    );

    const result = loadRelationalStats(db, self.id, opp.id);
    expect(result.record.wins).toBe(1);
    expect(result.record.losses).toBe(0);
    expect(result.record.gamesPaired).toBe(1);
    expect(result.record.avgMargin).toBe(260);
    expect(result.timesBowledWith).toBe(1);
    // Sanity that the underlying scores are real.
    const views = loadH2HSessions(db, self.id, opp.id);
    expect(scoreGame(views[0]?.selfGames[0] ?? []).total).toBe(300);
    expect(scoreGame(views[0]?.opponentGames[0] ?? []).total).toBe(40);
  });

  it('zero shared sessions => all-zero/null record, null withWithout, 0 count, no NaN/throw', () => {
    const { db } = createMemoryDb();
    const ownerUserId = newUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const stranger = createPlayer(db, { name: 'Stranger' });

    // Self has a solo game; the opponent has never bowled with self.
    createGameWithFrames(
      db,
      { ownerUserId, playerId: self.id, date: '2026-06-17' },
      perfectGameFrames(),
    );

    const result = loadRelationalStats(db, self.id, stranger.id);

    expect(result.record).toEqual({
      wins: 0,
      losses: 0,
      ties: 0,
      gamesPaired: 0,
      avgMargin: null,
      selfAvg: null,
      opponentAvg: null,
    });
    expect(result.withWithout.withAvg).toBeNull();
    expect(result.withWithout.withoutAvg).toBeNull();
    expect(result.withWithout.withStrikePct).toBeNull();
    expect(result.withWithout.withoutStrikePct).toBeNull();
    expect(result.withWithout.sessionsWith).toBe(0);
    expect(result.timesBowledWith).toBe(0);

    // No NaN anywhere in the numeric fields.
    for (const v of Object.values(result.record)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
    for (const v of Object.values(result.withWithout)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('guest opponent behaves identically to a linked one (math keys on player ids)', () => {
    // Two parallel worlds with identical scores: one opponent is a guest
    // (userId null), the other is a linked account. Results must be identical.
    function run(linkOpponent: boolean): ReturnType<typeof loadRelationalStats> {
      const { db } = createMemoryDb();
      const ownerUserId = newUser(db);
      const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
      const opp = linkOpponent
        ? createPlayer(db, { name: 'Linked', userId: newUser(db) })
        : createPlayer(db, { name: 'Guest' });

      const session = createSession(db, {
        ownerUserId,
        date: '2026-06-17',
        isGroup: true,
      });
      createGameWithFrames(
        db,
        { ownerUserId, playerId: self.id, date: '2026-06-17', sessionId: session.id },
        openGameFrames(5, 4), // 90
      );
      createGameWithFrames(
        db,
        { ownerUserId, playerId: opp.id, date: '2026-06-17', sessionId: session.id },
        openGameFrames(3, 3), // 60
      );
      return loadRelationalStats(db, self.id, opp.id);
    }

    const guest = run(false);
    const linked = run(true);
    expect(linked).toEqual(guest);
    expect(guest.record.wins).toBe(1);
    expect(guest.record.avgMargin).toBe(30); // 90 - 60
    expect(guest.timesBowledWith).toBe(1);
  });
});
