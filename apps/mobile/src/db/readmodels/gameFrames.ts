/**
 * Read-model adapters: a single game's persisted frames → the pure-domain input
 * shapes from S2 (`scoreGame` / `computeGameStats`).
 *
 * These adapters are the ONE-WAY glue between `db/` and `domain/`: the db side
 * is allowed to import domain types (here, `PinMask`), but the domain must NEVER
 * import db. Adapters carry zero scoring/stats logic — they only reshape rows.
 *
 * Tombstoned frames are already excluded by `listFramesByGame`, which also
 * returns rows ordered by `frameNo`, so the resulting arrays are in frame order
 * (frame 1 .. frame 10) without any re-sorting here.
 */

import type { PinMask } from '../../domain/splits';
import { listFramesByGame } from '../repositories/frames';
import type { Db } from '../types';

/**
 * A game as the `number[][]` the domain expects: one inner `number[]` of throw
 * pin-counts per frame, in frame order. Maps each row's `throws` JSON array
 * directly. An empty game (no frames) yields `[]`, which the domain scores as 0.
 */
export function loadGameFrames(db: Db, gameId: string): number[][] {
  return listFramesByGame(db, gameId).map((frame) => frame.throws);
}

/**
 * A game's per-frame leave masks, one `PinMask` per frame in frame order,
 * matching the domain's `leaves[i]` contract (S2): the mask of pins STANDING
 * after the first ball of frame `i` — i.e. the rack facing the SECOND throw.
 *
 * Mapping: `frames.pinState` (S5) is an array of one 10-bit mask per throw, each
 * being the pins standing BEFORE that throw. The state facing the second throw
 * is therefore `pinState[1]` (the mask before throw 2). So this adapter extracts
 * `pinState[1]` for each frame.
 *
 * When a frame has fewer than 2 `pinState` entries — a strike (only a first
 * ball was thrown, so no "before throw 2" state exists) or an incomplete /
 * untracked frame — it yields `0` (an empty rack), which the split / single-pin
 * classifiers correctly treat as "no leave to convert".
 */
export function loadLeaveMasks(db: Db, gameId: string): PinMask[] {
  return listFramesByGame(db, gameId).map((frame) => frame.pinState[1] ?? 0);
}
