/**
 * Pure bowling scoring. NO React Native / Expo / React / Node imports — this
 * module is unit-testable in plain Node and portable.
 *
 * A game is up to 10 frames. Each frame is an array of throw pin-counts:
 *   - frames 1-9: a strike is `[10]`; otherwise two throws `[a, b]`.
 *   - frame 10: two throws, or three when a strike/spare earns a fill ball.
 *
 * Scoring rules (frames 1-9): strike = 10 + next two throws; spare = 10 + next
 * one throw; open = sum of two throws. 10th frame: the fill balls score only
 * within the frame (they are not their own frames). A frame's score is `null`
 * (blank) until its bonus throws have been bowled.
 */

const STRIKE_PINS = 10;

export interface ScoredFrame {
  frameNo: number;
  throws: number[];
  isStrike: boolean;
  isSpare: boolean;
  /** Points credited to this frame including bonus; `null` until determinable. */
  frameScore: number | null;
  /** Cumulative running total through this frame; `null` until determinable. */
  cumulativeScore: number | null;
}

export interface ScoredGame {
  frames: ScoredFrame[];
  /** Highest confirmed cumulative total (sum of all currently-scorable frames). */
  total: number;
  /** True when all 10 frames are present and fully scored. */
  isComplete: boolean;
}

/** Collect the next `n` throw pin-counts after frame index `f`, flattening across frames. */
function nextThrows(frames: number[][], f: number, n: number): number[] {
  const out: number[] = [];
  for (let g = f + 1; g < frames.length && out.length < n; g++) {
    const frame = frames[g];
    if (!frame) continue;
    for (const t of frame) {
      if (out.length >= n) break;
      out.push(t);
    }
  }
  return out;
}

/** A 10th frame is complete once it has the throws its strike/spare status requires. */
function isTenthComplete(throws: number[]): boolean {
  if (throws.length < 2) return false;
  const first = throws[0] ?? 0;
  const second = throws[1] ?? 0;
  const earnedFill = first === STRIKE_PINS || first + second === STRIKE_PINS;
  return earnedFill ? throws.length >= 3 : throws.length >= 2;
}

function sum(throws: number[]): number {
  return throws.reduce((acc, t) => acc + t, 0);
}

export function scoreGame(frames: number[][]): ScoredGame {
  const scored: ScoredFrame[] = [];
  let runningTotal = 0;
  // Once a frame can't yet be scored, every later frame's running total is blank too.
  let stillScoring = true;

  for (let f = 0; f < frames.length; f++) {
    const throws = frames[f] ?? [];
    const frameNo = f + 1;
    const first = throws[0] ?? 0;
    const second = throws[1] ?? 0;

    const isStrike = throws.length >= 1 && first === STRIKE_PINS;
    let isSpare = false;
    let frameScore: number | null = null;

    if (frameNo < 10) {
      if (isStrike) {
        const bonus = nextThrows(frames, f, 2);
        if (bonus.length === 2) frameScore = STRIKE_PINS + sum(bonus);
      } else if (throws.length >= 2) {
        isSpare = first + second === STRIKE_PINS;
        if (isSpare) {
          const bonus = nextThrows(frames, f, 1);
          if (bonus.length === 1) frameScore = STRIKE_PINS + sum(bonus);
        } else {
          frameScore = first + second;
        }
      }
    } else {
      isSpare = !isStrike && throws.length >= 2 && first + second === STRIKE_PINS;
      if (isTenthComplete(throws)) {
        frameScore = sum(throws);
      }
    }

    let cumulativeScore: number | null = null;
    if (stillScoring && frameScore !== null) {
      runningTotal += frameScore;
      cumulativeScore = runningTotal;
    } else {
      stillScoring = false;
    }

    scored.push({ frameNo, throws, isStrike, isSpare, frameScore, cumulativeScore });
  }

  const isComplete = frames.length === 10 && scored.every((s) => s.frameScore !== null);

  return { frames: scored, total: runningTotal, isComplete };
}
