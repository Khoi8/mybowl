/**
 * React binding for the vanilla sessions store.
 *
 * This is the ONLY sessions module allowed to import `react`. The store
 * (`store.ts`) stays RN/react-free so it is unit-testable headless; this hook
 * wraps it with `useStore` for components. The store is a module-level
 * SINGLETON (like players) — its actions are stateless delegations to the
 * repos, so a shared instance is fine and every screen sees the same one.
 */
import { useStore } from 'zustand';

import { createSessionsStore, type SessionsState } from './store';

/** App-wide sessions store, shared by every screen that touches sessions. */
const sessionsStore = createSessionsStore();

/** Subscribe to the sessions store actions. */
export function useSession(): SessionsState {
  return useStore(sessionsStore);
}
