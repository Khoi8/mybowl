/**
 * React binding for the vanilla arsenal store.
 *
 * This is the ONLY arsenal module allowed to import `react`. The store
 * (`store.ts`) stays RN/react-free so it is unit-testable headless; this hook
 * wraps it with `useStore` for components. The store is a module-level
 * SINGLETON because the arsenal is shared app-wide — the arsenal screen and the
 * per-throw ball picker in scoring must see the same list.
 */
import { useStore } from 'zustand';

import { createArsenalStore, type ArsenalState } from './store';

/** App-wide arsenal store, shared by every screen that touches balls. */
const arsenalStore = createArsenalStore();

/** Subscribe to the arsenal; re-renders on any store change. */
export function useArsenal(): ArsenalState {
  return useStore(arsenalStore);
}
