/**
 * Session repository — offline-first CRUD over `sessions` plus its
 * `session_players` join rows.
 *
 * A Session holds the shared per-outing context (location, lane, oil pattern)
 * once; a solo game is just the degenerate one-participant case (`isGroup`
 * false), so there is a single code path here, not two.
 *
 * Sync metadata stamping and tombstone semantics mirror the player repo: writes
 * set `updatedAt = Date.now()` + `syncStatus = 'pending'`; deletes set
 * `deletedAt` rather than physically removing rows; `get`/`list` exclude
 * tombstones.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { enqueueWithWrite } from '../../sync/outbox';
import { sessionPlayers, sessions, type NewSession, type Session } from '../schema';
import type { Db } from '../types';

export type CreateSessionInput = {
  ownerUserId: string;
  date: string;
  locationId?: string | null;
  lane?: string | null;
  oilPatternId?: string | null;
  isGroup?: boolean;
  notes?: string | null;
};

export type SessionPatch = Partial<{
  date: string;
  locationId: string | null;
  lane: string | null;
  oilPatternId: string | null;
  isGroup: boolean;
  notes: string | null;
}>;

export type SessionPlayerRow = typeof sessionPlayers.$inferSelect;

/** Insert a session, returning the created row. Write + 'upsert' op are atomic. */
export function createSession(db: Db, input: CreateSessionInput): Session {
  const values: NewSession = { ownerUserId: input.ownerUserId, date: input.date };
  if (input.locationId !== undefined) values.locationId = input.locationId;
  if (input.lane !== undefined) values.lane = input.lane;
  if (input.oilPatternId !== undefined) values.oilPatternId = input.oilPatternId;
  if (input.isGroup !== undefined) values.isGroup = input.isGroup;
  if (input.notes !== undefined) values.notes = input.notes;

  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(sessions).values(values).returning().all();
      if (row === undefined) throw new Error('createSession: insert returned no row');
      return row;
    },
    (row) => ({
      entityTable: 'sessions',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateSession(db: Db, id: string, patch: SessionPatch): Session {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx
        .update(sessions)
        .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(eq(sessions.id, id))
        .returning()
        .all();
      if (row === undefined) throw new Error(`updateSession: no session with id ${id}`);
      return row;
    },
    (row) => ({
      entityTable: 'sessions',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Tombstone a session (soft delete). */
export function softDeleteSession(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(sessions)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(sessions.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'sessions',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** Fetch a live session by id; tombstoned rows are treated as gone. */
export function getSessionById(db: Db, id: string): Session | undefined {
  const [row] = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    .all();
  return row;
}

/** List a recorder's live sessions. */
export function listSessionsByOwner(db: Db, ownerUserId: string): Session[] {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.ownerUserId, ownerUserId), isNull(sessions.deletedAt)))
    .all();
}

/** Add a participant to a session, returning the created join row. */
export function addSessionPlayer(
  db: Db,
  input: { sessionId: string; playerId: string; turnOrder?: number | null },
): SessionPlayerRow {
  const values: typeof sessionPlayers.$inferInsert = {
    sessionId: input.sessionId,
    playerId: input.playerId,
  };
  if (input.turnOrder !== undefined) values.turnOrder = input.turnOrder;

  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(sessionPlayers).values(values).returning().all();
      if (row === undefined) throw new Error('addSessionPlayer: insert returned no row');
      return row;
    },
    (row) => ({
      entityTable: 'session_players',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Tombstone a session-player join row. */
export function softDeleteSessionPlayer(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(sessionPlayers)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(sessionPlayers.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'session_players',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** List a session's live participants. */
export function listSessionPlayers(db: Db, sessionId: string): SessionPlayerRow[] {
  return db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, sessionId), isNull(sessionPlayers.deletedAt)))
    .all();
}
