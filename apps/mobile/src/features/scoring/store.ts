/**
 * In-progress game store for manual frame-by-frame entry.
 *
 * RN-FREE by design: this module imports only `zustand/vanilla`, the pure
 * scoring/validation domain, and the (Node-testable) db repositories. It must
 * NOT import `react-native`/`expo`/`nativewind`/`react` — that would break the
 * headless Vitest run. The React binding lives in `useScoreEntry.ts`, and the
 * `.tsx` screens consume that hook.
 *
 * No scoring or validation logic is re-implemented here: completion and
 * legality are decided ENTIRELY by `domain/validation` (`validateFrame`) and
 * the running total by `domain/scoring` (`scoreGame`). The store only sequences
 * throws into frames and advances the cursor.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import { scoreGame, type ScoredGame } from '../../domain/scoring';
import { validateFrame } from '../../domain/validation';
import type { Db } from '../../db/types';
import { createGameWithFrames, type GameFrameInput } from '../../db/repositories/games';
import { buildPinState } from './pinState';

const STRIKE_PINS = 10;
const LAST_FRAME = 10;

/** Metadata stamped onto the game + frames at commit time. */
export interface GameMeta {
  ownerUserId: string;
  playerId: string;
  date: string;
  sessionId?: string | null;
  leagueId?: string | null;
  locationId?: string | null;
  lane?: string | null;
  oilPatternId?: string | null;
  notes?: string | null;
}

export interface ScoreEntryState {
  /** One entry per started frame; each is the list of throw pin-counts so far. */
  readonly frames: number[][];
  /**
   * Ball tagged per throw, indexed PARALLEL to `frames` (same shape): null where
   * a throw was recorded without a selected ball. Scoring is ball-agnostic — the
   * domain never sees this; it is carried only so `commit` can persist it into
   * each frame's `ballIdPerThrow`.
   */
  readonly ballIdPerThrow: (string | null)[][];
  /** Zero-based index of the frame currently accepting throws (0..9). */
  readonly currentFrame: number;
  /** Reason the last `recordThrow` was rejected, else `null`. */
  readonly lastError: string | null;

  /**
   * Append a throw to the current frame iff `validateFrame` accepts it. The
   * optional `ballId` tags which ball threw it (null/omitted = untagged).
   */
  recordThrow: (pins: number, ballId?: string | null) => void;
  /** Remove the most recent throw (and step back a frame if one empties). */
  undoLastThrow: () => void;
  /** Clear all entry back to a fresh game. */
  reset: () => void;
  /** Live scored view (running totals) computed from the current frames. */
  scored: () => ScoredGame;
  /** Persist the game + frames to SQLite (offline-first). Returns the game id. */
  commit: (db: Db, meta: GameMeta) => string;
}

/** True once frame `frameNo` (1-based) has all the throws it can legally take. */
function isFrameComplete(frameNo: number, throws: number[]): boolean {
  const first = throws[0] ?? 0;
  if (frameNo < LAST_FRAME) {
    return first === STRIKE_PINS || throws.length >= 2;
  }
  // 10th: a strike/spare on the first two earns a fill ball (3 throws total),
  // otherwise the frame is done after two.
  if (throws.length < 2) return false;
  const second = throws[1] ?? 0;
  const earnedFill = first === STRIKE_PINS || first + second === STRIKE_PINS;
  return earnedFill ? throws.length >= 3 : throws.length >= 2;
}

/** Throws-so-far for the current frame (empty if a new frame is being started). */
function currentThrows(frames: number[][], currentFrame: number): number[] {
  return frames[currentFrame] ?? [];
}

/**
 * Legal pin counts (0..10) for the NEXT throw against the in-progress game,
 * derived from `validateFrame` — components disable any button not in this set
 * rather than re-deriving the rule. Empty once the game is complete.
 */
export function legalNextPins(state: {
  frames: number[][];
  currentFrame: number;
}): number[] {
  const { frames, currentFrame } = state;
  if (currentFrame >= LAST_FRAME) return [];
  const existing = currentThrows(frames, currentFrame);
  const frameNo = currentFrame + 1;
  const legal: number[] = [];
  for (let pins = 0; pins <= STRIKE_PINS; pins++) {
    if (validateFrame(frameNo, [...existing, pins]).valid) legal.push(pins);
  }
  return legal;
}

export function createScoreEntryStore(): StoreApi<ScoreEntryState> {
  return createStore<ScoreEntryState>((set, get) => ({
    frames: [],
    ballIdPerThrow: [],
    currentFrame: 0,
    lastError: null,

    recordThrow: (pins: number, ballId: string | null = null): void => {
      const { frames, ballIdPerThrow, currentFrame } = get();
      if (currentFrame >= LAST_FRAME) {
        set({ lastError: 'game is already complete' });
        return;
      }

      const existing = currentThrows(frames, currentFrame);
      const candidate = [...existing, pins];
      const frameNo = currentFrame + 1;

      // Delegate ALL legality to the domain — no rules duplicated here.
      const result = validateFrame(frameNo, candidate);
      if (!result.valid) {
        set({ lastError: result.reason ?? 'illegal throw' });
        return;
      }

      const nextFrames = frames.slice();
      nextFrames[currentFrame] = candidate;
      // Mirror the throw into the parallel ball-tag structure.
      const nextBalls = ballIdPerThrow.slice();
      nextBalls[currentFrame] = [...(ballIdPerThrow[currentFrame] ?? []), ballId];
      const advance = isFrameComplete(frameNo, candidate);

      set({
        frames: nextFrames,
        ballIdPerThrow: nextBalls,
        currentFrame: advance ? currentFrame + 1 : currentFrame,
        lastError: null,
      });
    },

    undoLastThrow: (): void => {
      const { frames, ballIdPerThrow, currentFrame } = get();
      // The frame the last throw landed in is the current one if it has throws,
      // otherwise the previous (completed) frame.
      const here = currentThrows(frames, currentFrame);
      const targetIndex = here.length > 0 ? currentFrame : currentFrame - 1;
      if (targetIndex < 0) {
        set({ lastError: null });
        return;
      }

      const targetThrows = frames[targetIndex] ?? [];
      if (targetThrows.length === 0) {
        set({ lastError: null });
        return;
      }

      const nextFrames = frames.slice();
      const nextBalls = ballIdPerThrow.slice();
      const trimmed = targetThrows.slice(0, -1);
      const trimmedBalls = (ballIdPerThrow[targetIndex] ?? []).slice(0, -1);
      if (trimmed.length === 0) {
        nextFrames.splice(targetIndex, 1);
        nextBalls.splice(targetIndex, 1);
      } else {
        nextFrames[targetIndex] = trimmed;
        nextBalls[targetIndex] = trimmedBalls;
      }
      set({
        frames: nextFrames,
        ballIdPerThrow: nextBalls,
        currentFrame: targetIndex,
        lastError: null,
      });
    },

    reset: (): void => {
      set({ frames: [], ballIdPerThrow: [], currentFrame: 0, lastError: null });
    },

    scored: (): ScoredGame => scoreGame(get().frames),

    commit: (db: Db, meta: GameMeta): string => {
      const { frames, ballIdPerThrow } = get();
      const frameInputs: GameFrameInput[] = frames.map((throws, idx) => {
        const isTenth = idx + 1 === LAST_FRAME;
        const tags = ballIdPerThrow[idx] ?? [];
        return {
          frameNo: idx + 1,
          throws,
          // Per-throw ball tag, aligned to `throws`; null for any untagged throw
          // (defensively padded so the arrays always line up). Scoring never
          // touches this — it is pure equipment metadata.
          ballIdPerThrow: throws.map((_, t) => tags[t] ?? null),
          pinState: buildPinState(throws, isTenth),
        };
      });

      const { game } = createGameWithFrames(
        db,
        {
          ownerUserId: meta.ownerUserId,
          playerId: meta.playerId,
          date: meta.date,
          sessionId: meta.sessionId ?? null,
          leagueId: meta.leagueId ?? null,
          locationId: meta.locationId ?? null,
          lane: meta.lane ?? null,
          oilPatternId: meta.oilPatternId ?? null,
          notes: meta.notes ?? null,
        },
        frameInputs,
      );
      return game.id;
    },
  }));
}
