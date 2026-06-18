import { describe, expect, it } from 'vitest';

import { players, users } from '../../db/schema';
import { createMemoryDb } from '../../db/testing/memoryDb';
import { createScoreEntryStore } from '../scoring/store';
import { listGamesBySession } from '../../db/repositories/games';
import { createSessionsStore } from './store';

type MemDb = ReturnType<typeof createMemoryDb>['db'];

function seedUser(db: MemDb): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

function seedPlayer(db: MemDb, name: string): string {
  const [player] = db.insert(players).values({ name }).returning().all();
  if (player === undefined) throw new Error('unreachable');
  return player.id;
}

function seedSelf(db: MemDb, userId: string, name: string): string {
  const [player] = db
    .insert(players)
    .values({ name, isSelf: true, userId })
    .returning()
    .all();
  if (player === undefined) throw new Error('unreachable');
  return player.id;
}

/** Bowl a single open frame so the scoring store has a committable game. */
function commitOneGame(
  db: MemDb,
  meta: ReturnType<ReturnType<typeof createSessionsStore>['getState']['gameMetaFor']>,
): string {
  const score = createScoreEntryStore();
  // A minimal complete game: nine open frames + an open tenth.
  for (let i = 0; i < 10; i++) {
    score.getState().recordThrow(3);
    score.getState().recordThrow(4);
  }
  return score.getState().commit(db, meta);
}

describe('sessions store', () => {
  describe('solo == one-participant proof (single code path)', () => {
    it('startSolo yields exactly one participant and isGroup:false', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const store = createSessionsStore();

      const { session, participant } = store.getState().startSolo(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        selfPlayerId,
      });

      expect(session.isGroup).toBe(false);
      const participants = store.getState().listParticipants(db, session.id);
      expect(participants).toHaveLength(1);
      expect(participants[0]?.id).toBe(participant.id);
      expect(participants[0]?.playerId).toBe(selfPlayerId);
    });

    it('a 2-participant group session has the SAME shape; only isGroup + count differ', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const mikeId = seedPlayer(db, 'Mike');
      const store = createSessionsStore();

      // Solo: via startSolo (which delegates to createSession + addParticipant).
      const solo = store.getState().startSolo(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        locationId: null,
        lane: 'lane 5',
        selfPlayerId,
      });

      // Group: via the SAME createSession + addParticipant functions directly.
      const groupSession = store.getState().createSession(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        lane: 'lane 5',
        isGroup: true,
      });
      store.getState().addParticipant(db, groupSession.id, selfPlayerId);
      store.getState().addParticipant(db, groupSession.id, mikeId);

      // Same structural shape: identical column key set on both session rows.
      expect(Object.keys(groupSession).sort()).toEqual(Object.keys(solo.session).sort());

      // The ONLY material differences: isGroup and participant count.
      expect(solo.session.isGroup).toBe(false);
      expect(groupSession.isGroup).toBe(true);
      expect(store.getState().listParticipants(db, solo.session.id)).toHaveLength(1);
      expect(store.getState().listParticipants(db, groupSession.id)).toHaveLength(2);

      // Same shared physical session_players table — no separate solo flow/table.
      const soloParts = store.getState().listParticipants(db, solo.session.id);
      const groupParts = store.getState().listParticipants(db, groupSession.id);
      expect(Object.keys(soloParts[0] ?? {}).sort()).toEqual(
        Object.keys(groupParts[0] ?? {}).sort(),
      );
    });
  });

  describe('context inheritance (gameMetaFor)', () => {
    it('carries the session locationId/lane/oilPatternId/sessionId/ownerUserId', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const store = createSessionsStore();

      const session = store.getState().createSession(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        lane: 'lane 7',
        isGroup: false,
      });

      const meta = store.getState().gameMetaFor(session, selfPlayerId);
      expect(meta.ownerUserId).toBe(userId);
      expect(meta.playerId).toBe(selfPlayerId);
      expect(meta.sessionId).toBe(session.id);
      expect(meta.lane).toBe('lane 7');
      expect(meta.locationId).toBe(session.locationId);
      expect(meta.oilPatternId).toBe(session.oilPatternId);
      expect(meta.date).toBe('2026-06-18');
    });

    it('committing a game with the inherited meta persists matching context columns', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const store = createSessionsStore();

      const { session } = store.getState().startSolo(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        lane: 'lane 7',
        selfPlayerId,
      });

      const meta = store.getState().gameMetaFor(session, selfPlayerId);
      const gameId = commitOneGame(db, meta);

      const persisted = listGamesBySession(db, session.id);
      expect(persisted).toHaveLength(1);
      const game = persisted[0];
      expect(game?.id).toBe(gameId);
      expect(game?.sessionId).toBe(session.id);
      expect(game?.ownerUserId).toBe(session.ownerUserId);
      expect(game?.playerId).toBe(selfPlayerId);
      expect(game?.lane).toBe(session.lane);
      expect(game?.locationId).toBe(session.locationId);
      expect(game?.oilPatternId).toBe(session.oilPatternId);
    });
  });

  describe('addParticipant links existing player ids', () => {
    it('listParticipants returns linked players, with turnOrder when set', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const mikeId = seedPlayer(db, 'Mike');
      const store = createSessionsStore();

      const session = store.getState().createSession(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        isGroup: true,
      });
      store.getState().addParticipant(db, session.id, selfPlayerId, 1);
      store.getState().addParticipant(db, session.id, mikeId, 2);

      const participants = store.getState().listParticipants(db, session.id);
      expect(participants.map((p) => p.playerId)).toEqual([selfPlayerId, mikeId]);
      expect(participants.map((p) => p.turnOrder)).toEqual([1, 2]);
    });
  });

  describe('per-participant game grouping', () => {
    it('groups each participant with only their own games', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const mikeId = seedPlayer(db, 'Mike');
      const store = createSessionsStore();

      const session = store.getState().createSession(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        isGroup: true,
      });
      store.getState().addParticipant(db, session.id, selfPlayerId);
      store.getState().addParticipant(db, session.id, mikeId);

      // Self bowls two games, Mike one.
      commitOneGame(db, store.getState().gameMetaFor(session, selfPlayerId));
      commitOneGame(db, store.getState().gameMetaFor(session, selfPlayerId));
      commitOneGame(db, store.getState().gameMetaFor(session, mikeId));

      const grouped = store.getState().listSessionGamesByPlayer(db, session.id);
      expect(grouped).toHaveLength(2);

      const selfGroup = grouped.find((g) => g.participant.playerId === selfPlayerId);
      const mikeGroup = grouped.find((g) => g.participant.playerId === mikeId);
      expect(selfGroup?.games).toHaveLength(2);
      expect(mikeGroup?.games).toHaveLength(1);
      expect(selfGroup?.games.every((g) => g.playerId === selfPlayerId)).toBe(true);
      expect(mikeGroup?.games.every((g) => g.playerId === mikeId)).toBe(true);
    });

    it('a participant with no games yet appears with an empty games array', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const selfPlayerId = seedSelf(db, userId, 'Me');
      const store = createSessionsStore();

      const { session } = store.getState().startSolo(db, {
        ownerUserId: userId,
        date: '2026-06-18',
        selfPlayerId,
      });

      const grouped = store.getState().listSessionGamesByPlayer(db, session.id);
      expect(grouped).toHaveLength(1);
      expect(grouped[0]?.games).toEqual([]);
    });
  });
});
