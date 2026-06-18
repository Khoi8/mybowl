/**
 * Repository barrel — offline-first CRUD modules over the SQLite schema.
 *
 * Every writer takes an INJECTED `Db` handle (no global singleton), stamps sync
 * metadata on writes, and tombstones on delete. See `../types.ts` for the `Db`
 * type rationale.
 */

export * from './players';
export * from './sessions';
export * from './games';
export * from './frames';
export * from './balls';
export * from './laneConditions';
