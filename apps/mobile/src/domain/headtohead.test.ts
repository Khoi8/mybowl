import { describe, it, expect } from 'vitest';
import { scoreGame } from './scoring';
import {
  headToHead,
  withWithout,
  timesBowledWith,
  type H2HSessionView,
  type SelfSessionView,
} from './headtohead';

// --- helpers: games with known, obvious scores ----------------------------

/** A perfect game: twelve strikes ⇒ 300. */
function perfect(): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < 9; i++) frames.push([10]);
  frames.push([10, 10, 10]);
  return frames;
}

/** A game of all open frames knocking `a`+`b` per frame (b ≤ 9, no spare). */
function openGame(a: number, b: number): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < 10; i++) frames.push([a, b]);
  return frames;
}

// Sanity-check the helpers so the expected H2H numbers below are trustworthy.
describe('test helpers produce known scores', () => {
  it('perfect() scores 300', () => {
    expect(scoreGame(perfect()).total).toBe(300);
  });
  it('openGame(4,5) scores 90; openGame(3,4) scores 70', () => {
    expect(scoreGame(openGame(4, 5)).total).toBe(90);
    expect(scoreGame(openGame(3, 4)).total).toBe(70);
  });
});

describe('headToHead', () => {
  it('tallies W/L/T including ties', () => {
    // Session A: self wins game1 (300 vs 90), loses game2 (70 vs 90).
    // Session B: tie (90 vs 90).
    const sessions: H2HSessionView[] = [
      {
        sessionId: 'A',
        selfGames: [perfect(), openGame(3, 4)],
        opponentGames: [openGame(4, 5), openGame(4, 5)],
      },
      {
        sessionId: 'B',
        selfGames: [openGame(4, 5)],
        opponentGames: [openGame(4, 5)],
      },
    ];
    const r = headToHead(sessions);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.ties).toBe(1);
    expect(r.gamesPaired).toBe(3);
  });

  it('pairs by order and drops unpaired trailing games', () => {
    // Self bowled 3, opponent bowled 2 ⇒ only first 2 pairs count.
    // Pair1: 300 vs 90 (win). Pair2: 90 vs 90 (tie). Self's 3rd game (a 300)
    // must NOT affect the record or averages.
    const sessions: H2HSessionView[] = [
      {
        sessionId: 'A',
        selfGames: [perfect(), openGame(4, 5), perfect()],
        opponentGames: [openGame(4, 5), openGame(4, 5)],
      },
    ];
    const r = headToHead(sessions);
    expect(r.gamesPaired).toBe(2);
    expect(r.wins).toBe(1);
    expect(r.ties).toBe(1);
    expect(r.losses).toBe(0);
    // selfAvg over the two PAIRED games = (300 + 90) / 2 = 195 — not pulled up
    // by the dropped third 300.
    expect(r.selfAvg).toBe(195);
    expect(r.opponentAvg).toBe(90);
    // margin = ((300-90) + (90-90)) / 2 = 105
    expect(r.avgMargin).toBe(105);
  });

  it('margin sign is (self - opponent): negative when self loses', () => {
    // Self loses both: 70 vs 90 and 90 vs 300.
    const sessions: H2HSessionView[] = [
      {
        sessionId: 'A',
        selfGames: [openGame(3, 4), openGame(4, 5)],
        opponentGames: [openGame(4, 5), perfect()],
      },
    ];
    const r = headToHead(sessions);
    expect(r.losses).toBe(2);
    expect(r.wins).toBe(0);
    // ((70-90) + (90-300)) / 2 = (-20 + -210) / 2 = -115
    expect(r.avgMargin).toBe(-115);
    expect(r.selfAvg).toBe(80);
    expect(r.opponentAvg).toBe(195);
  });

  it('single shared session produces sane output (no divide-by-zero)', () => {
    const sessions: H2HSessionView[] = [
      {
        sessionId: 'A',
        selfGames: [openGame(4, 5)],
        opponentGames: [openGame(3, 4)],
      },
    ];
    const r = headToHead(sessions);
    expect(r.gamesPaired).toBe(1);
    expect(r.wins).toBe(1);
    expect(r.avgMargin).toBe(20); // 90 - 70
    expect(r.selfAvg).toBe(90);
    expect(r.opponentAvg).toBe(70);
  });

  it('zero shared sessions ⇒ zeros and nulls, no throw', () => {
    const r = headToHead([]);
    expect(r).toEqual({
      wins: 0,
      losses: 0,
      ties: 0,
      gamesPaired: 0,
      avgMargin: null,
      selfAvg: null,
      opponentAvg: null,
    });
  });

  it('a session where one side bowled zero games contributes no pairs', () => {
    const sessions: H2HSessionView[] = [
      { sessionId: 'A', selfGames: [perfect()], opponentGames: [] },
      { sessionId: 'B', selfGames: [], opponentGames: [openGame(4, 5)] },
    ];
    const r = headToHead(sessions);
    expect(r.gamesPaired).toBe(0);
    expect(r.avgMargin).toBeNull();
    expect(r.selfAvg).toBeNull();
    expect(r.opponentAvg).toBeNull();
  });

  it('guest-vs-self parity: math keys only on scores, not on account status', () => {
    // The same scores produce the same record regardless of who the opponent
    // "is" — there is no account concept in the input at all.
    const games: H2HSessionView[] = [
      {
        sessionId: 'A',
        selfGames: [perfect()],
        opponentGames: [openGame(4, 5)],
      },
    ];
    expect(headToHead(games)).toEqual(headToHead(games));
    const r = headToHead(games);
    expect(r.wins).toBe(1);
    expect(r.avgMargin).toBe(210); // 300 - 90
  });
});

describe('timesBowledWith', () => {
  it('counts sessions with at least one paired game', () => {
    const sessions: H2HSessionView[] = [
      { sessionId: 'A', selfGames: [perfect()], opponentGames: [openGame(4, 5)] },
      { sessionId: 'B', selfGames: [perfect()], opponentGames: [openGame(4, 5)] },
      // Only self bowled — not a real shared outing.
      { sessionId: 'C', selfGames: [perfect()], opponentGames: [] },
      // Only opponent bowled.
      { sessionId: 'D', selfGames: [], opponentGames: [openGame(4, 5)] },
    ];
    expect(timesBowledWith(sessions)).toBe(2);
  });

  it('is 0 for no sessions', () => {
    expect(timesBowledWith([])).toBe(0);
  });
});

describe('withWithout', () => {
  it('partitions sessions by opponent presence and averages game scores', () => {
    const sessions: SelfSessionView[] = [
      // With opponent: two games, scores 300 and 90 ⇒ contributes those games.
      {
        sessionId: 'A',
        opponentPresent: true,
        selfGames: [perfect(), openGame(4, 5)],
      },
      // Without: one game, score 70.
      { sessionId: 'B', opponentPresent: false, selfGames: [openGame(3, 4)] },
    ];
    const s = withWithout(sessions);
    expect(s.sessionsWith).toBe(1);
    expect(s.sessionsWithout).toBe(1);
    // withAvg = mean of game scores across present sessions = (300 + 90) / 2 = 195
    expect(s.withAvg).toBe(195);
    // withoutAvg = 70
    expect(s.withoutAvg).toBe(70);
    expect(s.withStrikePct).not.toBeNull();
    expect(s.withoutStrikePct).not.toBeNull();
  });

  it('strike% reflects the stats definition per partition', () => {
    // "With" partition is a single perfect game: every first ball is a strike.
    const sessions: SelfSessionView[] = [
      { sessionId: 'A', opponentPresent: true, selfGames: [perfect()] },
      { sessionId: 'B', opponentPresent: false, selfGames: [openGame(0, 0)] },
    ];
    const s = withWithout(sessions);
    expect(s.withStrikePct).toBe(100);
    // No strikes in a gutter game.
    expect(s.withoutStrikePct).toBe(0);
  });

  it('empty present/absent partitions yield null averages, no NaN', () => {
    const onlyWith: SelfSessionView[] = [
      { sessionId: 'A', opponentPresent: true, selfGames: [perfect()] },
    ];
    const s = withWithout(onlyWith);
    expect(s.sessionsWith).toBe(1);
    expect(s.sessionsWithout).toBe(0);
    expect(s.withoutAvg).toBeNull();
    expect(s.withoutStrikePct).toBeNull();
    expect(s.withAvg).toBe(300);
  });

  it('empty input ⇒ all nulls / zeros, no throw', () => {
    const s = withWithout([]);
    expect(s).toEqual({
      withAvg: null,
      withoutAvg: null,
      withStrikePct: null,
      withoutStrikePct: null,
      sessionsWith: 0,
      sessionsWithout: 0,
    });
  });

  it('a present session with no self games does not break averaging', () => {
    const sessions: SelfSessionView[] = [
      { sessionId: 'A', opponentPresent: true, selfGames: [] },
      { sessionId: 'B', opponentPresent: true, selfGames: [perfect()] },
    ];
    const s = withWithout(sessions);
    expect(s.sessionsWith).toBe(2);
    expect(s.withAvg).toBe(300); // only the one real game counts
  });
});
