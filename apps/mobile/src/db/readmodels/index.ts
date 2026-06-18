/**
 * Read-model barrel — adapters mapping persisted rows into the pure-domain
 * input shapes (S2 stats, S3 head-to-head). The db side may import domain types;
 * the domain never imports db.
 */

export * from './gameFrames';
export * from './seriesForPlayer';
export * from './h2hSessions';
