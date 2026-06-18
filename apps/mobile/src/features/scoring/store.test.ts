import { describe, expect, it } from 'vitest';

import { scoreGame } from '../../domain/scoring';
import { users } from '../../db/schema';
import { createMemoryDb } from '../../db/testing/memoryDb';
import { createPlayer } from '../../db/repositories/players';
import { listFramesByGame } from '../../db/repositories/frames';
import { getGameById } from '../../db/repositories/games';
import { createScoreEntryStore, legalNextPins } from './store';

/** Record a sequence of throws against a fresh store and return its api. */
function play(...throws: number[]): ReturnType<typeof createScoreEntryStore> {
  const store = createScoreEntryStore();
  for (const t of throws) store.getState().recordThrow(t);
  return store;
}

describe('scoring store', () => {
  it('rejects an illegal second throw via validateFrame; state unchanged + error surfaced', () => {
    const store = play(7);
    store.getState().recordThrow(5); // 7 + 5 = 12 > 10 in a frame 1-9

    const s = store.getState();
    expect(s.frames).toEqual([[7]]);
    expect(s.currentFrame).toBe(0);
    expect(s.lastError).toBeTruthy();
  });

  it('clears lastError on the next legal throw', () => {
    const store = play(7);
    store.getState().recordThrow(5);
    expect(store.getState().lastError).toBeTruthy();
    store.getState().recordThrow(3); // 7 + 3 = 10 spare, legal
    const s = store.getState();
    expect(s.lastError).toBeNull();
    expect(s.frames).toEqual([[7, 3]]);
    expect(s.currentFrame).toBe(1);
  });

  it('advances on a strike (single throw) and on a completed open frame', () => {
    const store = play(10);
    expect(store.getState().frames).toEqual([[10]]);
    expect(store.getState().currentFrame).toBe(1);

    store.getState().recordThrow(4);
    expect(store.getState().currentFrame).toBe(1); // mid open frame
    store.getState().recordThrow(5);
    expect(store.getState().currentFrame).toBe(2); // open frame complete
  });

  it('builds a perfect game in progress and scored().total matches scoreGame (300)', () => {
    // 12 strikes: nine frames + the 10th with two fill strikes.
    const throws = Array.from({ length: 12 }, () => 10);
    const store = play(...throws);
    const s = store.getState();
    expect(s.scored().total).toBe(300);
    expect(s.scored().total).toBe(scoreGame(s.frames).total);
    expect(s.scored().isComplete).toBe(true);
  });

  it('matches scoreGame for a known open game', () => {
    // Frames: 9-0 x10 -> 90. (no 10th-frame fill earned)
    const throws: number[] = [];
    for (let i = 0; i < 10; i++) throws.push(9, 0);
    const store = play(...throws);
    const s = store.getState();
    expect(s.scored().total).toBe(90);
    expect(s.scored().total).toBe(scoreGame(s.frames).total);
  });

  it('10th-frame fill: 3rd throw allowed only when a strike/spare is earned', () => {
    // Get to frame 10 with nine open frames (current cursor -> index 9).
    const throws: number[] = [];
    for (let i = 0; i < 9; i++) throws.push(4, 5);
    const store = play(...throws);
    expect(store.getState().currentFrame).toBe(9);

    // Spare in the 10th earns a fill ball.
    store.getState().recordThrow(7);
    store.getState().recordThrow(3); // spare
    expect(store.getState().currentFrame).toBe(9); // still on 10th, fill earned
    expect(store.getState().frames[9]).toEqual([7, 3]);

    store.getState().recordThrow(8); // fill ball, legal
    expect(store.getState().frames[9]).toEqual([7, 3, 8]);
    expect(store.getState().currentFrame).toBe(10); // game complete
    expect(store.getState().scored().isComplete).toBe(true);
  });

  it('10th-frame open: no 3rd throw earned, frame closes after two', () => {
    const throws: number[] = [];
    for (let i = 0; i < 9; i++) throws.push(4, 5);
    const store = play(...throws);
    store.getState().recordThrow(4);
    store.getState().recordThrow(5); // open, no fill
    expect(store.getState().currentFrame).toBe(10);

    store.getState().recordThrow(3); // should be refused: game complete
    expect(store.getState().lastError).toBeTruthy();
    expect(store.getState().frames[9]).toEqual([4, 5]);
  });

  it('undo removes the last throw and steps back across frames', () => {
    const store = play(10, 4); // frame1 strike (advanced), frame2 has [4]
    expect(store.getState().currentFrame).toBe(1);
    store.getState().undoLastThrow(); // remove the 4 -> frame2 empties
    expect(store.getState().frames).toEqual([[10]]);
    expect(store.getState().currentFrame).toBe(1);

    store.getState().undoLastThrow(); // remove the strike -> frame1 gone
    expect(store.getState().frames).toEqual([]);
    expect(store.getState().currentFrame).toBe(0);

    store.getState().undoLastThrow(); // nothing to undo, no throw
    expect(store.getState().frames).toEqual([]);
    expect(store.getState().currentFrame).toBe(0);
  });

  it('legalNextPins reflects standing pins via the domain', () => {
    // Fresh frame: anything 0..10 is legal.
    expect(legalNextPins({ frames: [], currentFrame: 0 })).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // After a 7 in frames 1-9, only 0..3 keep the two-throw sum <= 10.
    expect(legalNextPins({ frames: [[7]], currentFrame: 0 })).toEqual([0, 1, 2, 3]);
    // Game complete -> no legal throws.
    const done: number[][] = [];
    for (let i = 0; i < 10; i++) done.push([4, 5]);
    expect(legalNextPins({ frames: done, currentFrame: 10 })).toEqual([]);
  });

  it('reset clears all entry', () => {
    const store = play(10, 9, 1, 5);
    store.getState().reset();
    expect(store.getState()).toMatchObject({
      frames: [],
      currentFrame: 0,
      lastError: null,
    });
  });

  it('commit persists a game + frames with pending sync metadata and pinState', () => {
    const { db } = createMemoryDb();
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: user.id });

    // A short legal game: strike, then 9/ spare, then open 8-0, then close out.
    const store = createScoreEntryStore();
    const seq = [10, 9, 1, 8, 0];
    for (const t of seq) store.getState().recordThrow(t);

    const gameId = store.getState().commit(db, {
      ownerUserId: user.id,
      playerId: self.id,
      date: '2026-06-18',
    });

    const game = getGameById(db, gameId);
    expect(game?.playerId).toBe(self.id);
    expect(game?.ownerUserId).toBe(user.id);
    expect(game?.sessionId).toBeNull();
    expect(game?.syncStatus).toBe('pending');

    const frames = listFramesByGame(db, gameId);
    expect(frames.map((f) => f.frameNo)).toEqual([1, 2, 3]);
    // pinState has one mask per throw; frame 1 (strike) sees a full rack.
    expect(frames[0]?.pinState).toEqual([0b1111111111]);
    expect(frames[0]?.throws).toEqual([10]);
    // Frame 2: full rack before throw 1; 1 pin (lowest bit) before throw 2.
    expect(frames[1]?.pinState).toEqual([0b1111111111, 0b0000000001]);
    expect(frames[1]?.ballIdPerThrow).toEqual([null, null]);
    expect(frames.every((f) => f.syncStatus === 'pending')).toBe(true);
  });
});
