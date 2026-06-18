/**
 * React binding for the vanilla players store.
 *
 * This is the ONLY players module allowed to import `react`. The store
 * (`store.ts`) stays RN/react-free so it is unit-testable headless; this hook
 * wraps it with `useStore` for components. The store is a module-level
 * SINGLETON (unlike scoring's per-screen store) because the contact list is
 * shared app-wide — the players screen and any add-person sheet must see the
 * same list.
 */
import { useStore } from 'zustand';

import { createPlayersStore, type PlayersState } from './store';

/** App-wide contact store, shared by every screen that touches players. */
const playersStore = createPlayersStore();

/** Subscribe to the contact list; re-renders on any store change. */
export function usePlayers(): PlayersState {
  return useStore(playersStore);
}
