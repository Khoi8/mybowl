/**
 * Lane-conditions store — log how a house played on a given VISIT.
 *
 * RN-FREE by design: this module imports only `zustand/vanilla` and the
 * (Node-testable) laneConditions repository. It must NOT import
 * `react-native`/`expo`/`nativewind`/`react` — that would break the headless
 * Vitest run. The React binding lives in `useLaneConditions.ts`, and the `.tsx`
 * form consumes that hook.
 *
 * PER-VISIT, NEVER PER-LOCATION (CLAUDE.md §6/§11): a lane condition is recorded
 * against a `sessionId` (the specific visit) AND a `locationId` (where). Logging
 * a second visit to the same house creates a SECOND row — there is no upsert of
 * "the location's condition." `listForSession` returns just that visit's logs.
 *
 * No persistence logic is re-implemented here — log/list/update/remove all
 * delegate to `db/repositories/laneConditions`.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Db } from '../../db/types';
import type { LaneConditionLog } from '../../db/schema';
import {
  createLaneConditionLog,
  listLaneConditionLogsBySession,
  softDeleteLaneConditionLog,
  updateLaneConditionLog,
  type CreateLaneConditionLogInput,
  type LaneConditionLogPatch,
} from '../../db/repositories/laneConditions';

export interface LaneConditionsState {
  /**
   * Log lane conditions for ONE visit. Always carries `ownerUserId` (recorder)
   * + `locationId` (where) + `sessionId` (which visit). Persists offline-first
   * and returns the created row.
   */
  logForSession: (
    db: Db,
    input: CreateLaneConditionLogInput & { sessionId: string },
  ) => LaneConditionLog;

  /** The visit's live lane-condition logs (by `sessionId`). */
  listForSession: (db: Db, sessionId: string) => LaneConditionLog[];

  /** Patch a log's domain fields. Returns the updated row. */
  update: (db: Db, id: string, patch: LaneConditionLogPatch) => LaneConditionLog;

  /** Tombstone a log (soft delete). */
  remove: (db: Db, id: string) => void;
}

export function createLaneConditionsStore(): StoreApi<LaneConditionsState> {
  return createStore<LaneConditionsState>(() => ({
    logForSession: (
      db: Db,
      input: CreateLaneConditionLogInput & { sessionId: string },
    ): LaneConditionLog => createLaneConditionLog(db, input),

    listForSession: (db: Db, sessionId: string): LaneConditionLog[] =>
      listLaneConditionLogsBySession(db, sessionId),

    update: (db: Db, id: string, patch: LaneConditionLogPatch): LaneConditionLog =>
      updateLaneConditionLog(db, id, patch),

    remove: (db: Db, id: string): void => softDeleteLaneConditionLog(db, id),
  }));
}
