# bowli build log

Reverse-chronological record of delivery iterations. Each entry: what slice,
who did it, the gate result, and the commit.

---

## Iteration 0 — bootstrap + scoring/validation domain (pre-loop)

- **Role:** Tech Lead
- **Scope:** Phase 0 monorepo bootstrap (pnpm workspace, strict TS, Vitest +
  coverage gate, ESLint domain-purity rule, Prettier) and the first half of
  Phase 1 — `domain/scoring.ts` (`scoreGame`) and `domain/validation.ts`
  (`validateFrame`), written test-first.
- **Gate:** 31 tests passing; 100% line/function/statement coverage on the
  domain core; typecheck, lint, format all green.
- **Commit:** `chore: bootstrap monorepo and pure scoring domain` (PR #1).

---

## Iteration 1 — S1 recognized-split lookup

- **Slice:** S1 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `domain/splits.ts` — hardcoded recognized-split table keyed on the
  10-bit standing-pin mask; `isSplit`, `splitName`, `isSinglePinLeave`,
  `maskFromPins`/`pinsFromMask`. Test-first (17 cases).
- **Review:** CHANGES-REQUESTED — reviewer caught that `4-5` and `5-6` are
  _adjacent_ (not gapped) leaves and must not be in the split table (CLAUDE.md
  §7 requires a gapped leave). Fix applied: removed both entries; rewrote the
  adjacent-non-split test to assert 2-3/4-5/5-6/9-10 are not splits. Re-reviewed
  clean.
- **Gate:** 46 tests passing; splits.ts 100% line/branch/function coverage;
  typecheck, lint, format all green.
- **Commit:** `feat(domain): add recognized-split lookup (S1)` (PR #1).

## Iteration 2 — S2 solo stats domain
- **Slice:** S2 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `domain/stats.ts` — `computeGameStats`, `computeSeriesStats`,
  `aggregatePinLeaves`. Reuses `scoreGame` (never re-derives scores) and
  `isSplit`/`isSinglePinLeave` (never re-infers splits). Ratios exposed with
  their underlying counts; every ratio `null` at a zero denominator. Test-first
  (33 cases).
- **Review:** PASS first pass. Null-not-NaN guarantee, "splits also count as
  spare attempts," derivation, and domain purity all verified.
- **Design decisions recorded:**
  - **Frame-10 strike% denominator:** each *fresh-rack* ball in the 10th is a
    first-ball opportunity (perfect game → 12 opps/12 strikes; all-spares →
    11 opps, strike% 0). Consciously chosen over the fixed-10 convention;
    documented in the module header. The stats-feature UI (S14) should note
    that the strike% denominator isn't a fixed 10.
  - **highSeries** = total pinfall across the given games.
  - **Clean game** = all 10 frames present and every frame marked.
  - Split/single-pin stats require per-frame leave masks; `null` when absent.
- **Follow-up (non-blocking):** partial-leaves case in `computeSeriesStats`
  (leaves shorter than games) is sane but untested — revisit if it matters.
- **Gate:** 81 tests passing; stats.ts 100% lines/functions (89% branches);
  typecheck, lint, format all green.
- **Commit:** `feat(domain): add solo stats (S2)` (PR #1).

<!-- New iterations are appended below this line by the Tech Lead. -->
