/**
 * React binding for the vanilla scoring store.
 *
 * This is the ONLY scoring module allowed to import `react`. The store
 * (`store.ts`) stays RN/react-free so it is unit-testable headless; this hook
 * wraps it with `useStore` for components. Each hook instance owns its own
 * store (one in-progress game per screen mount) via `useRef`.
 */
import { useRef } from 'react';
import { useStore } from 'zustand';

import { createScoreEntryStore, type ScoreEntryState } from './store';

/** Subscribe to the in-progress game; re-renders on any store change. */
export function useScoreEntry(): ScoreEntryState {
  const storeRef = useRef<ReturnType<typeof createScoreEntryStore>>();
  if (storeRef.current === undefined) {
    storeRef.current = createScoreEntryStore();
  }
  return useStore(storeRef.current);
}
