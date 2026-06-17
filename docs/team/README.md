# bowli delivery team — charters & operating loop

bowli is built by a small, role-specialized "team" of agents coordinated by a
tech-lead orchestrator. This document defines the roles and the loop they run.
It is the source of truth for *how* we work; `docs/slices/BACKLOG.md` is the
source of truth for *what* is left to do, and `docs/BUILD_LOG.md` records what
happened.

## Roles

| Role | Who | Responsibility |
| ---- | --- | -------------- |
| **Tech Lead (orchestrator)** | main session | Owns git (all commits/pushes), runs the loop, integrates agent output, runs the quality gate, keeps docs current. |
| **Architect** | `Plan` agent | Breaks features into vertical slices with acceptance criteria, file lists, and dependencies. Plans the next batch when the backlog empties. Does NOT write product code. |
| **FE Dev** | role-charter agent | Implements mobile (Expo/RN) feature slices and shared UI. Honors domain purity — no business logic in components. |
| **BE Dev** | role-charter agent | Implements pure domain (`apps/mobile/src/domain`), persistence (`apps/mobile/src/db`), sync (`apps/mobile/src/sync`), and the Go backend (`services/api`). |
| **Code Reviewer** | role-charter agent / `code-review` skill | Reviews each slice's diff for correctness, convention adherence, and spec fidelity before it is committed. Blocks on real issues. |

## The loop

```
while backlog has unblocked slices:
    1. Tech Lead picks the next unblocked slice from docs/slices/BACKLOG.md
    2. Architect: if the slice lacks a design, produce one (acceptance criteria,
       files, test plan). Recorded under docs/slices/<id>.md
    3. Dev (FE or BE): implement the slice test-first; run the gate locally
    4. Tech Lead: run the full gate (test+coverage, typecheck, lint, format)
    5. Code Reviewer: review the diff; return PASS or CHANGES-REQUESTED
    6. If CHANGES-REQUESTED: Dev addresses; back to step 4
    7. Tech Lead: commit (conventional commit) + push to PR #1; update
       docs/slices/BACKLOG.md status and append to docs/BUILD_LOG.md
when backlog is empty and more MVP features remain:
    Architect plans the next batch of slices → append to BACKLOG.md → continue
```

## Standing rules for every role (from CLAUDE.md)

- **Solo play is a one-participant session**, never a separate code path.
- Every game attributes to a `Player`; `owner_user_id` is only the recorder.
- **Domain stays pure** — no `react-native`/`expo`/`react`/`node:*` imports under
  `apps/mobile/src/domain/**` (ESLint enforces this).
- **Stats are derived, never stored.**
- **Migrations are forward-only.** Never edit a shipped migration.
- TypeScript strict, **no `any`**. `noUncheckedIndexedAccess` is on — guard or sum,
  don't index blindly.
- **Show the test first** for non-obvious scoring / head-to-head behavior.
- Conventional commits. The quality gate must be green before commit.

## Quality gate (Tech Lead runs before every commit)

```bash
pnpm exec vitest run --coverage   # domain coverage thresholds enforced
pnpm typecheck
pnpm lint
pnpm format:check
```
