import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { games, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import {
  createGame,
  createGameWithFrames,
  getGameById,
  listGamesByPlayer,
  listGamesBySession,
  softDeleteGame,
  updateGame,
} from './games';
import { createPlayer } from './players';
import { createSession } from './sessions';
import { listFramesByGame } from './frames';

function seed(db: ReturnType<typeof createMemoryDb>['db']): {
  ownerUserId: string;
  selfId: string;
  mikeId: string;
} {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  const self = createPlayer(db, { name: 'Me', isSelf: true, userId: user.id });
  const mike = createPlayer(db, { name: 'Mike' });
  return { ownerUserId: user.id, selfId: self.id, mikeId: mike.id };
}

describe('games repository', () => {
  it('round-trips a solo game (sessionId null)', () => {
    const { db } = createMemoryDb();
    const { ownerUserId, selfId } = seed(db);

    const game = createGame(db, { ownerUserId, playerId: selfId, date: '2026-06-17' });
    expect(game.sessionId).toBeNull();
    expect(game.playerId).toBe(selfId);
    expect(game.syncStatus).toBe('pending');

    expect(getGameById(db, game.id)).toEqual(game);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const { ownerUserId, selfId } = seed(db);
    const game = createGame(db, { ownerUserId, playerId: selfId, date: '2026-06-17' });

    db.update(games)
      .set({ syncStatus: 'synced', updatedAt: game.updatedAt - 1000 })
      .where(eq(games.id, game.id))
      .run();
    const before = getGameById(db, game.id);
    if (before === undefined) throw new Error('unreachable');

    const updated = updateGame(db, game.id, { notes: 'practice' });
    expect(updated.notes).toBe('practice');
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('soft delete tombstones: excluded from list but physically present', () => {
    const { db, sqlite } = createMemoryDb();
    const { ownerUserId, selfId } = seed(db);
    const a = createGame(db, { ownerUserId, playerId: selfId, date: '2026-06-17' });
    const b = createGame(db, { ownerUserId, playerId: selfId, date: '2026-06-18' });

    softDeleteGame(db, a.id);
    expect(getGameById(db, a.id)).toBeUndefined();
    expect(listGamesByPlayer(db, selfId).map((g) => g.id)).toEqual([b.id]);

    const raw = sqlite
      .prepare<
        [string],
        { deleted_at: number | null }
      >('SELECT deleted_at FROM games WHERE id = ?')
      .get(a.id);
    expect(raw?.deleted_at).not.toBeNull();
  });

  it('group session with 2 players + a game each persists and lists by session', () => {
    const { db } = createMemoryDb();
    const { ownerUserId, selfId, mikeId } = seed(db);
    const session = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });

    const g1 = createGame(db, {
      ownerUserId,
      playerId: selfId,
      sessionId: session.id,
      date: '2026-06-17',
    });
    const g2 = createGame(db, {
      ownerUserId,
      playerId: mikeId,
      sessionId: session.id,
      date: '2026-06-17',
    });

    const ids = listGamesBySession(db, session.id)
      .map((g) => g.id)
      .sort();
    expect(ids).toEqual([g1.id, g2.id].sort());
  });

  describe('createGameWithFrames', () => {
    it('creates a game and its frames atomically', () => {
      const { db } = createMemoryDb();
      const { ownerUserId, selfId } = seed(db);

      const { game, frames: created } = createGameWithFrames(
        db,
        { ownerUserId, playerId: selfId, date: '2026-06-17' },
        [
          { frameNo: 1, throws: [10], ballIdPerThrow: [null], pinState: [0b1111111111] },
          {
            frameNo: 2,
            throws: [9, 1],
            ballIdPerThrow: [null, null],
            pinState: [0b1111111111, 0b0000000001],
          },
        ],
      );

      expect(created).toHaveLength(2);
      expect(getGameById(db, game.id)?.id).toBe(game.id);
      expect(listFramesByGame(db, game.id).map((f) => f.frameNo)).toEqual([1, 2]);
    });

    it('rolls back the whole game if any frame insert fails', () => {
      const { db, sqlite } = createMemoryDb();
      const { ownerUserId, selfId } = seed(db);

      const dupId = '01931f00-0000-7000-8000-000000000abc';

      expect(() =>
        createGameWithFrames(db, { ownerUserId, playerId: selfId, date: '2026-06-17' }, [
          // Two frames share an explicit id -> PK violation on the second insert.
          {
            id: dupId,
            frameNo: 1,
            throws: [10],
            ballIdPerThrow: [null],
            pinState: [0b1111111111],
          },
          {
            id: dupId,
            frameNo: 2,
            throws: [10],
            ballIdPerThrow: [null],
            pinState: [0b1111111111],
          },
        ]),
      ).toThrow();

      // Neither the game nor any frame survived: full rollback, no partial game.
      const gameCount = sqlite
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM games')
        .get();
      const frameCount = sqlite
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM frames')
        .get();
      expect(gameCount?.c).toBe(0);
      expect(frameCount?.c).toBe(0);
    });
  });
});
