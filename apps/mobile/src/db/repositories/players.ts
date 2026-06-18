/**
 * Player repository — offline-first CRUD over the `players` table.
 *
 * A Player is a bowler identity (self, linked account, or guest). Every write
 * stamps sync metadata: inserts default `updatedAt`/`syncStatus` via the schema;
 * updates and tombstone deletes bump `updatedAt = Date.now()` and reset
 * `syncStatus = 'pending'` so the sync outbox (S17) will re-push them.
 *
 * Deletes are TOMBSTONES (`deletedAt` set), never physical — that is what lets
 * the change propagate through last-write-wins sync. `getPlayerById` and
 * `listPlayers` both treat tombstoned rows as gone (return undefined / exclude).
 *
 * The DB carries a partial unique index ("one live self-player per linked
 * account"); `createPlayer` is a pass-through that lets that backstop fire if a
 * second self is inserted — the app layer (S11) is the primary guardian.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { players, type NewPlayer, type Player } from '../schema';
import type { Db } from '../types';

/** Domain fields a caller supplies when creating a player. */
export type CreatePlayerInput = {
  name: string;
  isSelf?: boolean;
  userId?: string | null;
  avatar?: string | null;
};

/** Mutable domain fields on a player. Sync columns are managed by the repo. */
export type PlayerPatch = Partial<{
  name: string;
  isSelf: boolean;
  userId: string | null;
  avatar: string | null;
}>;

/** Insert a player, returning the created row (id + sync defaults populated). */
export function createPlayer(db: Db, input: CreatePlayerInput): Player {
  const values: NewPlayer = { name: input.name };
  if (input.isSelf !== undefined) values.isSelf = input.isSelf;
  if (input.userId !== undefined) values.userId = input.userId;
  if (input.avatar !== undefined) values.avatar = input.avatar;

  const [row] = db.insert(players).values(values).returning().all();
  if (row === undefined) throw new Error('createPlayer: insert returned no row');
  return row;
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updatePlayer(db: Db, id: string, patch: PlayerPatch): Player {
  const [row] = db
    .update(players)
    .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(players.id, id))
    .returning()
    .all();
  if (row === undefined) throw new Error(`updatePlayer: no player with id ${id}`);
  return row;
}

/** Tombstone a player (soft delete). Never physically removes the row. */
export function softDeletePlayer(db: Db, id: string): void {
  db.update(players)
    .set({ deletedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(players.id, id))
    .run();
}

/** Fetch a live player by id; tombstoned rows are treated as gone (undefined). */
export function getPlayerById(db: Db, id: string): Player | undefined {
  const [row] = db
    .select()
    .from(players)
    .where(and(eq(players.id, id), isNull(players.deletedAt)))
    .all();
  return row;
}

/** List all live (non-tombstoned) players. */
export function listPlayers(db: Db): Player[] {
  return db.select().from(players).where(isNull(players.deletedAt)).all();
}

/** The live self-player for an account, if one exists. */
export function getSelfPlayer(db: Db, userId: string): Player | undefined {
  const [row] = db
    .select()
    .from(players)
    .where(
      and(
        eq(players.userId, userId),
        eq(players.isSelf, true),
        isNull(players.deletedAt),
      ),
    )
    .all();
  return row;
}
