/**
 * Lane-condition-log repository — offline-first CRUD over `lane_condition_logs`.
 *
 * PER-VISIT, NEVER PER-LOCATION (CLAUDE.md §6/§11): a lane condition log is a
 * snapshot of how a house played on ONE specific visit. Each log is its own row
 * tied to a `locationId` (where) and, when bowling an outing, a `sessionId`
 * (which visit). This repo NEVER aggregates or upserts "the location's
 * condition" — logging a second visit to the same house creates a SECOND row,
 * it does not mutate the first. That is what lets lane conditions stay per-visit
 * session context rather than collapsing into a single per-location score.
 *
 * Sync metadata stamping and tombstone semantics mirror the other repos
 * (balls/sessions): inserts default `updatedAt`/`syncStatus` via the schema;
 * updates and tombstone deletes bump `updatedAt = Date.now()` and reset
 * `syncStatus = 'pending'`; deletes are tombstones (`deletedAt` set), never
 * physical; `get`/`list` exclude tombstoned rows.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { enqueueWithWrite } from '../../sync/outbox';
import {
  laneConditionLogs,
  type LaneConditionLog,
  type NewLaneConditionLog,
} from '../schema';
import type { Db } from '../types';

/** Recognized lane freshness, matching the schema column enum. */
export type LaneFreshness = NonNullable<LaneConditionLog['freshness']>;

/**
 * Domain fields a caller supplies when logging a visit's lane conditions. A log
 * ALWAYS carries `ownerUserId` (the recording account) + `locationId` (where);
 * `sessionId` ties it to the specific visit/outing.
 */
export type CreateLaneConditionLogInput = {
  ownerUserId: string;
  locationId: string;
  date: string;
  sessionId?: string | null;
  oilPatternId?: string | null;
  freshness?: LaneFreshness | null;
  playStyle?: string | null;
  carrydown?: string | null;
  holdNotes?: string | null;
  breakpointNotes?: string | null;
  rating1to5?: number | null;
};

/** Mutable domain fields on a log. Sync columns are managed by the repo. */
export type LaneConditionLogPatch = Partial<{
  date: string;
  sessionId: string | null;
  oilPatternId: string | null;
  freshness: LaneFreshness | null;
  playStyle: string | null;
  carrydown: string | null;
  holdNotes: string | null;
  breakpointNotes: string | null;
  rating1to5: number | null;
}>;

/**
 * Insert a lane-condition log, returning the created row. The insert and its
 * 'upsert' sync op are enqueued atomically. Always a NEW row — never an upsert
 * onto an existing location's condition.
 */
export function createLaneConditionLog(
  db: Db,
  input: CreateLaneConditionLogInput,
): LaneConditionLog {
  const values: NewLaneConditionLog = {
    ownerUserId: input.ownerUserId,
    locationId: input.locationId,
    date: input.date,
  };
  if (input.sessionId !== undefined) values.sessionId = input.sessionId;
  if (input.oilPatternId !== undefined) values.oilPatternId = input.oilPatternId;
  if (input.freshness !== undefined) values.freshness = input.freshness;
  if (input.playStyle !== undefined) values.playStyle = input.playStyle;
  if (input.carrydown !== undefined) values.carrydown = input.carrydown;
  if (input.holdNotes !== undefined) values.holdNotes = input.holdNotes;
  if (input.breakpointNotes !== undefined) values.breakpointNotes = input.breakpointNotes;
  if (input.rating1to5 !== undefined) values.rating1to5 = input.rating1to5;

  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(laneConditionLogs).values(values).returning().all();
      if (row === undefined) {
        throw new Error('createLaneConditionLog: insert returned no row');
      }
      return row;
    },
    (row) => ({
      entityTable: 'lane_condition_logs',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateLaneConditionLog(
  db: Db,
  id: string,
  patch: LaneConditionLogPatch,
): LaneConditionLog {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx
        .update(laneConditionLogs)
        .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(eq(laneConditionLogs.id, id))
        .returning()
        .all();
      if (row === undefined) {
        throw new Error(`updateLaneConditionLog: no log with id ${id}`);
      }
      return row;
    },
    (row) => ({
      entityTable: 'lane_condition_logs',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Tombstone a lane-condition log (soft delete). Never physically removes it. */
export function softDeleteLaneConditionLog(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(laneConditionLogs)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(laneConditionLogs.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'lane_condition_logs',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** Fetch a live log by id; tombstoned rows are treated as gone (undefined). */
export function getLaneConditionLogById(
  db: Db,
  id: string,
): LaneConditionLog | undefined {
  const [row] = db
    .select()
    .from(laneConditionLogs)
    .where(and(eq(laneConditionLogs.id, id), isNull(laneConditionLogs.deletedAt)))
    .all();
  return row;
}

/** List a single visit's live lane-condition logs (by `sessionId`). */
export function listLaneConditionLogsBySession(
  db: Db,
  sessionId: string,
): LaneConditionLog[] {
  return db
    .select()
    .from(laneConditionLogs)
    .where(
      and(
        eq(laneConditionLogs.sessionId, sessionId),
        isNull(laneConditionLogs.deletedAt),
      ),
    )
    .all();
}

/**
 * List a location's live lane-condition logs across ALL visits (by
 * `locationId`). Returns every per-visit row, not an aggregate — interpreting
 * them as history is the caller's job.
 */
export function listLaneConditionLogsByLocation(
  db: Db,
  locationId: string,
): LaneConditionLog[] {
  return db
    .select()
    .from(laneConditionLogs)
    .where(
      and(
        eq(laneConditionLogs.locationId, locationId),
        isNull(laneConditionLogs.deletedAt),
      ),
    )
    .all();
}
