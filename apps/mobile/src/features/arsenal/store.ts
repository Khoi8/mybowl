/**
 * Arsenal store — the equipment ("balls") you bowl with.
 *
 * RN-FREE by design: this module imports only `zustand/vanilla` and the
 * (Node-testable) balls repository. It must NOT import
 * `react-native`/`expo`/`nativewind`/`react` — that would break the headless
 * Vitest run. The React binding lives in `useArsenal.ts`, and the `.tsx`
 * screens consume that hook.
 *
 * RETIRE vs REMOVE (CLAUDE.md §6): retiring a ball keeps the row alive so it
 * still shows in history and old games keep referencing it; it is only hidden
 * from NEW per-throw tagging. Removing tombstones it (soft delete). The store
 * holds ONE loaded list (live rows incl. retired); `activeBalls()` /
 * `allBalls()` are derived selectors so we never desync two lists.
 *
 * No persistence logic is re-implemented here — list/create/update/retire/
 * tombstone all delegate to `db/repositories/balls`.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Db } from '../../db/types';
import type { Ball } from '../../db/schema';
import {
  createBall,
  listBalls,
  softDeleteBall,
  updateBall,
  type BallPatch,
  type CreateBallInput,
} from '../../db/repositories/balls';

export interface ArsenalState {
  /** Owner whose arsenal is currently loaded, or null before the first load. */
  readonly ownerUserId: string | null;
  /** All live (non-tombstoned) balls for the owner — retired ones INCLUDED. */
  readonly balls: readonly Ball[];

  /** (Re)load the arsenal for `ownerUserId` from SQLite. Excludes tombstones. */
  load: (db: Db, ownerUserId: string) => void;

  /** Add a ball. Persists offline-first and refreshes the list. */
  create: (db: Db, input: CreateBallInput) => Ball;

  /** Patch a ball's domain fields and refresh the list. */
  update: (db: Db, id: string, patch: BallPatch) => Ball;

  /** Retire a ball (hidden from new entry, kept in history). */
  retire: (db: Db, id: string) => Ball;

  /** Un-retire a ball (back into the active picker). */
  unretire: (db: Db, id: string) => Ball;

  /** Tombstone a ball (soft delete) and refresh the list. */
  remove: (db: Db, id: string) => void;

  /** Balls eligible for NEW per-throw tagging: live AND not retired. */
  activeBalls: () => Ball[];

  /** All live balls incl. retired (for the arsenal screen / history). */
  allBalls: () => Ball[];
}

export function createArsenalStore(): StoreApi<ArsenalState> {
  return createStore<ArsenalState>((set, get) => ({
    ownerUserId: null,
    balls: [],

    load: (db: Db, ownerUserId: string): void => {
      set({ ownerUserId, balls: listBalls(db, ownerUserId) });
    },

    create: (db: Db, input: CreateBallInput): Ball => {
      const created = createBall(db, input);
      get().load(db, input.ownerUserId);
      return created;
    },

    update: (db: Db, id: string, patch: BallPatch): Ball => {
      const updated = updateBall(db, id, patch);
      const { ownerUserId } = get();
      if (ownerUserId !== null) get().load(db, ownerUserId);
      return updated;
    },

    retire: (db: Db, id: string): Ball => get().update(db, id, { retired: true }),

    unretire: (db: Db, id: string): Ball => get().update(db, id, { retired: false }),

    remove: (db: Db, id: string): void => {
      softDeleteBall(db, id);
      const { ownerUserId } = get();
      if (ownerUserId !== null) get().load(db, ownerUserId);
    },

    activeBalls: (): Ball[] => get().balls.filter((b) => !b.retired),

    allBalls: (): Ball[] => [...get().balls],
  }));
}
