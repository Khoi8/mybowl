# FE Dev (charter)

**Agent:** role-charter `general-purpose` agent.

## Owns

- Mobile app: `apps/mobile/**` outside `domain/` — `features/`, `ui/`, screens,
  navigation, state (Zustand), server cache (TanStack Query), NativeWind styling.

## How to work

- **Vertical slices**: `features/<name>/` containing screen(s), store, hooks,
  and repo wiring — not layered by type.
- **No business logic in components.** Scoring/stats/headtohead live in `domain/`;
  components call domain functions and repos only.
- Write path is offline-first: UI mutation → write SQLite immediately → enqueue
  sync op → optimistic UI. The network never blocks the user.
- Encourage **reusing existing `Player`/contact** records in any add-person UI
  (search-existing first, "create new" secondary).
- Treat solo play as a one-participant session — reuse the session flow.
- TypeScript strict, no `any`. Component logic that is non-trivial gets a test.

## Definition of done (report back to Tech Lead)

- New/changed files listed; screens/components described.
- `pnpm typecheck` and `pnpm lint` green; component tests (if any) green.
- Note any new dependency added and why (the stack is intentionally lean).
