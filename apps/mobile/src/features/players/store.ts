/**
 * Players/contacts store — the "who you bowl with" surface.
 *
 * RN-FREE by design: this module imports only `zustand/vanilla` and the
 * (Node-testable) players repository. It must NOT import
 * `react-native`/`expo`/`nativewind`/`react` — that would break the headless
 * Vitest run. The React binding lives in `usePlayers.ts`, and the `.tsx`
 * screens consume that hook.
 *
 * THE CRUX (CLAUDE.md §6/§11): relational stats only accumulate when the SAME
 * `Player` row is reused across outings. So the add-person flow is
 * search-existing-FIRST: `search()` ranks the already-loaded contacts so the UI
 * can offer them prominently, and `createGuest()` is the explicit FALLBACK when
 * none of them is the right person.
 *
 * No persistence/identity logic is re-implemented here — list/create/update/
 * tombstone all delegate to `db/repositories/players`. The store only holds the
 * loaded list and ranks it for reuse.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Db } from '../../db/types';
import type { Player } from '../../db/schema';
import {
  createPlayer,
  getSelfPlayer,
  listPlayers,
  softDeletePlayer,
  updatePlayer,
  type PlayerPatch,
} from '../../db/repositories/players';

export interface PlayersState {
  /** All live (non-tombstoned) contacts, as last loaded from SQLite. */
  readonly players: readonly Player[];

  /** (Re)load the contact list from SQLite. Excludes tombstoned rows. */
  load: (db: Db) => void;

  /**
   * Reuse surface: existing contacts whose name matches `query`,
   * case-insensitive, ranked exact → prefix → substring (stable within a tier).
   * An empty/whitespace query returns the full list unranked. This is what the
   * add-person UI shows FIRST, so the user picks "Mike" instead of minting a
   * second "Mike".
   */
  search: (query: string) => Player[];

  /**
   * FALLBACK when no existing contact matches: create a guest (`userId: null`,
   * `isSelf: false`). Persists offline-first (repo stamps sync metadata) and
   * refreshes the in-memory list. Returns the new row.
   */
  createGuest: (db: Db, name: string) => Player;

  /**
   * Return the existing self-player for `userId`, or create it once
   * (`isSelf: true`, `userId` set). Enforces the single-self invariant: a
   * second self for the same account is never minted — the existing one is
   * returned. (The DB partial unique index is the backstop.)
   */
  ensureSelf: (db: Db, userId: string, name: string) => Player;

  /** Patch a contact's domain fields and refresh the list. */
  updatePlayer: (db: Db, id: string, patch: PlayerPatch) => Player;

  /** Tombstone a contact (soft delete) and refresh the list. */
  removePlayer: (db: Db, id: string) => void;
}

/** Match tier for ranking, lower sorts first; -1 = no match. */
function matchTier(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return -1;
}

export function createPlayersStore(): StoreApi<PlayersState> {
  return createStore<PlayersState>((set, get) => ({
    players: [],

    load: (db: Db): void => {
      set({ players: listPlayers(db) });
    },

    search: (query: string): Player[] => {
      const { players } = get();
      const q = query.trim().toLowerCase();
      if (q === '') return [...players];

      // Pair each contact with its match tier, drop non-matches, then sort by
      // tier. The pre-sort index keeps the sort stable within a tier (a
      // guarantee we don't depend on the engine's sort for).
      return players
        .map((p, index) => ({ p, index, tier: matchTier(p.name, q) }))
        .filter((m) => m.tier >= 0)
        .sort((a, b) => a.tier - b.tier || a.index - b.index)
        .map((m) => m.p);
    },

    createGuest: (db: Db, name: string): Player => {
      const created = createPlayer(db, { name, isSelf: false, userId: null });
      get().load(db);
      return created;
    },

    ensureSelf: (db: Db, userId: string, name: string): Player => {
      const existing = getSelfPlayer(db, userId);
      if (existing !== undefined) return existing;
      const created = createPlayer(db, { name, isSelf: true, userId });
      get().load(db);
      return created;
    },

    updatePlayer: (db: Db, id: string, patch: PlayerPatch): Player => {
      const updated = updatePlayer(db, id, patch);
      get().load(db);
      return updated;
    },

    removePlayer: (db: Db, id: string): void => {
      softDeletePlayer(db, id);
      get().load(db);
    },
  }));
}
