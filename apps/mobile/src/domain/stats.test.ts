import { describe, it, expect } from 'vitest';
import { scoreGame } from './scoring';
import { maskFromPins } from './splits';
import type { PinMask } from './splits';
import { computeGameStats, computeSeriesStats, aggregatePinLeaves } from './stats';

// --- small frame helpers for readability -----------------------------------

/** A frame from its two throw pin-counts (open or spare). */
function frame(a: number, b: number): number[] {
  return [a, b];
}
/** A strike frame (frames 1-9). */
const X = (): number[] => [10];

/** Perfect game: 12 strikes (9 frames + 10th = 3 strikes). */
function perfectGame(): number[][] {
  const f: number[][] = [];
  for (let i = 0; i < 9; i++) f.push([10]);
  f.push([10, 10, 10]);
  return f;
}

/** All-spares game: every frame 5/5, 10th gets a fill of 5. Scores 150. */
function allSpares(): number[][] {
  const f: number[][] = [];
  for (let i = 0; i < 9; i++) f.push([5, 5]);
  f.push([5, 5, 5]);
  return f;
}

/** Fully open game: every frame 4/5 (no strike, no spare). */
function fullyOpen(): number[][] {
  const f: number[][] = [];
  for (let i = 0; i < 10; i++) f.push([4, 5]);
  return f;
}

// Leave masks (standing after the first ball). For a frame whose first ball
// is a strike, the entry is unused; we put 0 (empty rack) for clarity.
const EMPTY: PinMask = 0;

describe('computeGameStats — perfect game', () => {
  const stats = computeGameStats(perfectGame());

  it('scores 300', () => {
    expect(stats.score).toBe(300);
    expect(stats.score).toBe(scoreGame(perfectGame()).total);
  });

  it('strike% is 100 with 12 strikes across 12 first-ball opportunities', () => {
    expect(stats.strikeCount).toBe(12);
    expect(stats.firstBallCount).toBe(12);
    expect(stats.strikePct).toBe(100);
  });

  it('is a clean game', () => {
    expect(stats.isCleanGame).toBe(true);
  });

  it('spareConversionPct is null (no spare attempts)', () => {
    expect(stats.spareAttempts).toBe(0);
    expect(stats.spareConversions).toBe(0);
    expect(stats.spareConversionPct).toBeNull();
  });

  it('split / single-pin pcts are null without leaves', () => {
    expect(stats.splitConversionPct).toBeNull();
    expect(stats.singlePinSparePct).toBeNull();
  });
});

describe('computeGameStats — all spares with fill', () => {
  const stats = computeGameStats(allSpares());

  it('scores 150', () => {
    expect(stats.score).toBe(150);
    expect(stats.score).toBe(scoreGame(allSpares()).total);
  });

  it('spare conversion is 100% over 10 attempts', () => {
    expect(stats.spareAttempts).toBe(10);
    expect(stats.spareConversions).toBe(10);
    expect(stats.spareConversionPct).toBe(100);
  });

  it('strike% is 0 (zero strikes; 11 opps incl. the fresh-rack fill ball)', () => {
    expect(stats.strikeCount).toBe(0);
    // 9 frames + opening ball + fill-after-spare (fresh rack) = 11.
    expect(stats.firstBallCount).toBe(11);
    expect(stats.strikePct).toBe(0);
  });

  it('is a clean game', () => {
    expect(stats.isCleanGame).toBe(true);
  });
});

describe('computeGameStats — fully open game', () => {
  const stats = computeGameStats(fullyOpen());

  it('is not clean', () => {
    expect(stats.isCleanGame).toBe(false);
  });

  it('spare conversion is 0% over 10 attempts (all missed)', () => {
    expect(stats.spareAttempts).toBe(10);
    expect(stats.spareConversions).toBe(0);
    expect(stats.spareConversionPct).toBe(0);
  });

  it('strike% is 0 over 10 opportunities', () => {
    expect(stats.strikeCount).toBe(0);
    expect(stats.firstBallCount).toBe(10);
    expect(stats.strikePct).toBe(0);
  });
});

describe('computeGameStats — single-pin spares with leaves', () => {
  // Frame 1: leave the 10-pin (single), then convert it (spare).
  // Frame 2: leave the 7-pin (single), then MISS it (open).
  // Frame 3: leave the 4-6 (multi, non-split bucket... actually 4-6 is a split),
  //          use 2-pin non-split bucket [2,3] to keep it a plain multi-pin leave.
  // Remaining frames: strikes to keep things simple.
  const frames: number[][] = [
    frame(9, 1), // converted single (10-pin)
    frame(9, 0), // missed single (7-pin)
    frame(8, 2), // converted multi-pin leave (2-3 bucket), spare made
    X(),
    X(),
    X(),
    X(),
    X(),
    X(),
    [10, 10, 10],
  ];
  const leaves: PinMask[] = [
    maskFromPins([10]), // single
    maskFromPins([7]), // single
    maskFromPins([2, 3]), // multi-pin, NOT a split
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
  ];
  const stats = computeGameStats(frames, leaves);

  it('single-pin% counts only single-pin attempts (2 attempts, 1 made)', () => {
    expect(stats.singlePinAttempts).toBe(2);
    expect(stats.singlePinConversions).toBe(1);
    expect(stats.singlePinSparePct).toBe(50);
  });

  it('multi-pin spare attempt excluded from single-pin tracking', () => {
    // frame 3 (2-3) is a spare attempt but not single-pin.
    expect(stats.singlePinAttempts).toBe(2);
  });

  it('generic spare attempts include the single-pin and multi-pin frames', () => {
    // frames 1,2,3 are spare attempts (first ball not a strike, pins left).
    expect(stats.spareAttempts).toBe(3);
    expect(stats.spareConversions).toBe(2); // frame1 + frame3 made; frame2 missed
  });

  it('no recognized splits faced ⇒ splitConversionPct null', () => {
    expect(stats.splitsFaced).toBe(0);
    expect(stats.splitConversionPct).toBeNull();
  });
});

describe('computeGameStats — splits faced (converted vs missed)', () => {
  // Frame 1: 7-10 split left, then CONVERTED (spare).
  // Frame 2: 4-6-7-10 split left, then MISSED (open).
  // Rest strikes.
  const frames: number[][] = [
    frame(8, 2), // converted split spare
    frame(6, 0), // missed split
    X(),
    X(),
    X(),
    X(),
    X(),
    X(),
    X(),
    [10, 10, 10],
  ];
  const leaves: PinMask[] = [
    maskFromPins([7, 10]),
    maskFromPins([4, 6, 7, 10]),
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
  ];
  const stats = computeGameStats(frames, leaves);

  it('counts 2 splits faced, 1 converted ⇒ 50%', () => {
    expect(stats.splitsFaced).toBe(2);
    expect(stats.splitsConverted).toBe(1);
    expect(stats.splitConversionPct).toBe(50);
  });

  it('splits are also counted in the generic spare attempts', () => {
    expect(stats.spareAttempts).toBe(2);
    expect(stats.spareConversions).toBe(1);
  });

  it('splits are not single-pin attempts', () => {
    expect(stats.singlePinAttempts).toBe(0);
    expect(stats.singlePinSparePct).toBeNull();
  });
});

describe('computeGameStats — frame 10 first-ball opportunities', () => {
  it('counts each fresh-rack first ball in the 10th as an opportunity', () => {
    // 9 opens (4/5) then 10th = X X 9 → two fresh-rack strikes + a fresh 9.
    const frames: number[][] = [];
    for (let i = 0; i < 9; i++) frames.push([4, 5]);
    frames.push([10, 10, 9]);
    const stats = computeGameStats(frames);
    // 9 first balls (frames 1-9) + 3 fresh-rack balls in the 10th = 12 opps.
    expect(stats.firstBallCount).toBe(12);
    // two strikes in the 10th.
    expect(stats.strikeCount).toBe(2);
  });

  it('a 10th-frame spare then fill ball: fill is a fresh-rack opportunity', () => {
    const frames: number[][] = [];
    for (let i = 0; i < 9; i++) frames.push([4, 5]);
    frames.push([7, 3, 10]); // spare then a strike fill
    const stats = computeGameStats(frames);
    // 9 + (first ball + fill ball) = 11 opportunities. (Spare second ball is
    // NOT a fresh-rack first ball.)
    expect(stats.firstBallCount).toBe(11);
    expect(stats.strikeCount).toBe(1); // the fill strike
  });
});

describe('computeGameStats — 10th frame leave classification', () => {
  it('classifies a split converted on the 10th opening rack', () => {
    const frames: number[][] = [];
    for (let i = 0; i < 9; i++) frames.push(X());
    frames.push([8, 2, 9]); // 7-10 left, converted spare, then a 9 fill
    const leaves: PinMask[] = [];
    for (let i = 0; i < 9; i++) leaves.push(EMPTY);
    leaves.push(maskFromPins([7, 10]));
    const stats = computeGameStats(frames, leaves);
    expect(stats.splitsFaced).toBe(1);
    expect(stats.splitsConverted).toBe(1);
    expect(stats.splitConversionPct).toBe(100);
  });

  it('classifies a single-pin spare on the 10th opening rack', () => {
    const frames: number[][] = [];
    for (let i = 0; i < 9; i++) frames.push(X());
    frames.push([9, 1, 7]); // 10-pin left, converted, then a 7 fill
    const leaves: PinMask[] = [];
    for (let i = 0; i < 9; i++) leaves.push(EMPTY);
    leaves.push(maskFromPins([10]));
    const stats = computeGameStats(frames, leaves);
    expect(stats.singlePinAttempts).toBe(1);
    expect(stats.singlePinConversions).toBe(1);
    expect(stats.singlePinSparePct).toBe(100);
  });
});

describe('computeGameStats — incomplete / in-progress games', () => {
  it('an incomplete regular frame is not a spare attempt and not clean', () => {
    // Only 3 frames bowled, frame 3 has a single throw in progress.
    const stats = computeGameStats([frame(4, 5), frame(3, 6), [7]]);
    expect(stats.isCleanGame).toBe(false);
    // frame 3 contributes a first-ball opp but no spare attempt yet.
    expect(stats.firstBallCount).toBe(3);
    expect(stats.spareAttempts).toBe(2);
  });

  it('a 10th frame with only one throw so far is treated as open', () => {
    const frames: number[][] = [];
    for (let i = 0; i < 9; i++) frames.push(X());
    frames.push([7]); // first ball only, not yet complete
    const stats = computeGameStats(frames);
    expect(stats.isCleanGame).toBe(false);
    expect(stats.spareAttempts).toBe(0);
  });
});

describe('computeSeriesStats', () => {
  it('high game / high series / average over 3 games', () => {
    const games = [perfectGame(), allSpares(), fullyOpen()];
    const stats = computeSeriesStats(games);
    expect(stats.gameCount).toBe(3);
    expect(stats.highGame).toBe(300);
    // 300 + 150 + 90 = 540
    expect(stats.totalPinfall).toBe(540);
    expect(stats.highSeries).toBe(540); // series total across the given games
    expect(stats.average).toBe(180);
    expect(stats.cleanGameCount).toBe(2); // perfect + all-spares
  });

  it('rolls up rate stats across games', () => {
    const games = [allSpares(), allSpares()];
    const stats = computeSeriesStats(games);
    // 20 spare attempts, all made.
    expect(stats.spareConversionPct).toBe(100);
    // 20 first-ball opps, 0 strikes.
    expect(stats.strikePct).toBe(0);
  });

  it('rolls up split / single-pin stats when leaves provided', () => {
    const game: number[][] = [
      frame(8, 2), // 7-10 converted
      frame(9, 1), // 10-pin single converted
      X(),
      X(),
      X(),
      X(),
      X(),
      X(),
      X(),
      [10, 10, 10],
    ];
    const leaves: PinMask[] = [
      maskFromPins([7, 10]),
      maskFromPins([10]),
      EMPTY,
      EMPTY,
      EMPTY,
      EMPTY,
      EMPTY,
      EMPTY,
      EMPTY,
      EMPTY,
    ];
    const stats = computeSeriesStats([game, game], [leaves, leaves]);
    expect(stats.splitConversionPct).toBe(100); // 2 faced, 2 converted
    expect(stats.singlePinSparePct).toBe(100); // 2 attempts, 2 made
  });

  it('empty series ⇒ sane zero/null output, no NaN', () => {
    const stats = computeSeriesStats([]);
    expect(stats.gameCount).toBe(0);
    expect(stats.totalPinfall).toBe(0);
    expect(stats.average).toBeNull();
    expect(stats.highGame).toBeNull();
    expect(stats.highSeries).toBeNull();
    expect(stats.cleanGameCount).toBe(0);
    expect(stats.strikePct).toBeNull();
    expect(stats.spareConversionPct).toBeNull();
    expect(stats.splitConversionPct).toBeNull();
    expect(stats.singlePinSparePct).toBeNull();
    expect(Number.isNaN(stats.average ?? 0)).toBe(false);
  });

  it('series stats without leaves leave split/single-pin pcts null', () => {
    const stats = computeSeriesStats([fullyOpen(), fullyOpen()]);
    expect(stats.splitConversionPct).toBeNull();
    expect(stats.singlePinSparePct).toBeNull();
    expect(stats.spareConversionPct).toBe(0);
  });
});

describe('aggregatePinLeaves', () => {
  it('sums standing counts per pin across frames and games', () => {
    const gameA = {
      frames: [frame(9, 1), frame(8, 2), X()],
      leaves: [maskFromPins([10]), maskFromPins([7, 10]), 0],
    };
    const gameB = {
      frames: [frame(7, 3), frame(9, 1)],
      leaves: [maskFromPins([7, 10, 4]), maskFromPins([10])],
    };
    const map = aggregatePinLeaves([gameA, gameB]);
    // pin 10 standing in: A f1, A f2, B f1, B f2 = 4
    expect(map[10]).toBe(4);
    // pin 7 standing in: A f2, B f1 = 2
    expect(map[7]).toBe(2);
    // pin 4 standing in: B f1 = 1
    expect(map[4]).toBe(1);
    // pin 1 never left
    expect(map[1]).toBe(0);
  });

  it('returns a full 1-10 map with zeros for an empty input', () => {
    const map = aggregatePinLeaves([]);
    for (let pin = 1; pin <= 10; pin++) {
      expect(map[pin]).toBe(0);
    }
  });

  it('ignores frames whose leave mask is 0 (strike / clean first ball)', () => {
    const map = aggregatePinLeaves([{ frames: [X(), X()], leaves: [0, 0] }]);
    for (let pin = 1; pin <= 10; pin++) {
      expect(map[pin]).toBe(0);
    }
  });
});
