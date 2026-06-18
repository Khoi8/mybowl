/**
 * React binding for the vanilla lane-conditions store.
 *
 * This is the ONLY laneConditions module allowed to import `react`. The store
 * (`store.ts`) stays RN/react-free so it is unit-testable headless; this hook
 * wraps it with `useStore` for components. The store is a module-level
 * SINGLETON (like sessions/players) — its actions are stateless delegations to
 * the repo, so a shared instance is fine and every screen sees the same one.
 */
import { useStore } from 'zustand';

import { createLaneConditionsStore, type LaneConditionsState } from './store';

/** App-wide lane-conditions store, shared by every screen that logs conditions. */
const laneConditionsStore = createLaneConditionsStore();

/** Subscribe to the lane-conditions store actions. */
export function useLaneConditions(): LaneConditionsState {
  return useStore(laneConditionsStore);
}
