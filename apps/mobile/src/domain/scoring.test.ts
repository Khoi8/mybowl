import { describe, it, expect } from 'vitest';
import { scoreGame } from './scoring';

/** Build the canonical 9 identical opening frames plus a custom 10th. */
function game(firstNine: number[][], tenth: number[]): number[][] {
  return [...firstNine, tenth];
}

const nine = (frame: number[]): number[][] => Array.from({ length: 9 }, () => [...frame]);

describe('scoreGame — canonical games', () => {
  it('scores a perfect game (12 strikes) as 300', () => {
    const frames = game(nine([10]), [10, 10, 10]);
    const g = scoreGame(frames);

    expect(g.total).toBe(300);
    expect(g.isComplete).toBe(true);
    expect(g.frames[0]?.cumulativeScore).toBe(30);
    expect(g.frames[8]?.cumulativeScore).toBe(270);
    expect(g.frames[9]?.cumulativeScore).toBe(300);
    expect(g.frames.every((f) => f.isStrike)).toBe(true);
  });

  it('scores all spares with a fill ball as 150', () => {
    const frames = game(nine([5, 5]), [5, 5, 5]);
    const g = scoreGame(frames);

    expect(g.total).toBe(150);
    expect(g.isComplete).toBe(true);
    expect(g.frames[0]?.isSpare).toBe(true);
    expect(g.frames[0]?.frameScore).toBe(15);
  });

  it('scores a fully open game', () => {
    const frames = Array.from({ length: 10 }, () => [4, 5]);
    const g = scoreGame(frames);

    expect(g.total).toBe(90);
    expect(g.isComplete).toBe(true);
    expect(g.frames[0]?.isStrike).toBe(false);
    expect(g.frames[0]?.isSpare).toBe(false);
  });

  it('handles a strike then 9-miss in the 10th frame', () => {
    // first nine open frames at 9 each = 81; tenth = 10 + 9 + 0 = 19 => 100
    const frames = game(nine([4, 5]), [10, 9, 0]);
    const g = scoreGame(frames);

    expect(g.frames[9]?.isStrike).toBe(true);
    expect(g.frames[9]?.frameScore).toBe(19);
    expect(g.total).toBe(100);
    expect(g.isComplete).toBe(true);
  });
});

describe('scoreGame — bonus & running-score behaviour', () => {
  it('leaves a strike frame blank until two bonus throws exist', () => {
    const g = scoreGame([[10]]);
    expect(g.frames[0]?.isStrike).toBe(true);
    expect(g.frames[0]?.frameScore).toBeNull();
    expect(g.frames[0]?.cumulativeScore).toBeNull();
    expect(g.isComplete).toBe(false);
  });

  it('scores a strike once its next two throws are known', () => {
    const g = scoreGame([[10], [3, 4]]);
    expect(g.frames[0]?.frameScore).toBe(17);
    expect(g.frames[0]?.cumulativeScore).toBe(17);
    expect(g.frames[1]?.cumulativeScore).toBe(24);
  });

  it('leaves a spare frame blank until one bonus throw exists', () => {
    const g = scoreGame([[7, 3]]);
    expect(g.frames[0]?.isSpare).toBe(true);
    expect(g.frames[0]?.frameScore).toBeNull();
    expect(g.frames[0]?.cumulativeScore).toBeNull();
  });

  it('chains strikes correctly (turkey reaches across frames)', () => {
    const g = scoreGame([[10], [10], [10], [3, 4]]);
    expect(g.frames[0]?.frameScore).toBe(30); // 10 + 10 + 10
    expect(g.frames[1]?.frameScore).toBe(23); // 10 + 10 + 3
    expect(g.frames[2]?.frameScore).toBe(17); // 10 + 3 + 4
    expect(g.frames[3]?.frameScore).toBe(7); // open
  });

  it('stops the running total at the first not-yet-scorable frame', () => {
    // frame 1 open (scorable), frame 2 strike awaiting bonus
    const g = scoreGame([[4, 5], [10]]);
    expect(g.frames[0]?.cumulativeScore).toBe(9);
    expect(g.frames[1]?.cumulativeScore).toBeNull();
    expect(g.total).toBe(9);
  });

  it('handles an empty game', () => {
    const g = scoreGame([]);
    expect(g.total).toBe(0);
    expect(g.isComplete).toBe(false);
    expect(g.frames).toHaveLength(0);
  });

  it('treats an in-progress open frame (one throw) as not yet scorable', () => {
    const g = scoreGame([[4]]);
    expect(g.frames[0]?.frameScore).toBeNull();
    expect(g.isComplete).toBe(false);
  });

  it('scores a 10th-frame spare with its fill ball', () => {
    const frames = game(nine([4, 5]), [7, 3, 5]);
    const g = scoreGame(frames);
    expect(g.frames[9]?.isSpare).toBe(true);
    expect(g.frames[9]?.frameScore).toBe(15); // 7 + 3 + 5
  });
});
