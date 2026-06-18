/**
 * Read-only scorecard: renders each frame's throw marks and the running
 * cumulative total straight from a `ScoredGame` (produced by the pure
 * `scoreGame` domain). NO scoring logic here.
 */
import { ScrollView, Text, View } from 'react-native';

import type { ScoredFrame, ScoredGame } from '../../domain/scoring';

interface ScorecardProps {
  readonly scored: ScoredGame;
  /** Zero-based index of the frame currently accepting throws. */
  readonly currentFrame: number;
}

const STRIKE_PINS = 10;

/** Bowling throw marks: X for strike, / for spare, "-" for a miss, else count. */
function throwMarks(frame: ScoredFrame): string {
  const out: string[] = [];
  for (let i = 0; i < frame.throws.length; i++) {
    const pins = frame.throws[i] ?? 0;
    const prev = frame.throws[i - 1] ?? 0;
    if (pins === STRIKE_PINS) {
      out.push('X');
    } else if (i > 0 && prev !== STRIKE_PINS && prev + pins === STRIKE_PINS) {
      out.push('/');
    } else if (pins === 0) {
      out.push('-');
    } else {
      out.push(String(pins));
    }
  }
  return out.join(' ');
}

export function Scorecard({ scored, currentFrame }: ScorecardProps): React.JSX.Element {
  return (
    <ScrollView horizontal className="border-y border-gray-300">
      <View className="flex-row">
        {scored.frames.map((frame) => {
          const isActive = frame.frameNo - 1 === currentFrame;
          return (
            <View
              key={frame.frameNo}
              className={
                isActive
                  ? 'min-w-16 border-r border-blue-500 bg-blue-50 p-2'
                  : 'min-w-16 border-r border-gray-300 p-2'
              }
            >
              <Text className="text-center text-xs text-gray-500">{frame.frameNo}</Text>
              <Text className="text-center text-sm font-medium">{throwMarks(frame)}</Text>
              <Text className="text-center text-base font-bold">
                {frame.cumulativeScore ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
