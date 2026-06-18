/**
 * Pin-count entry pad + per-throw ball tag.
 *
 * Renders the active-ball picker (S13) above buttons 0..10; buttons whose pin
 * count is illegal for the next throw (per `legalNextPins`, which delegates to
 * `validateFrame`) are disabled. NO business logic here — legality comes from
 * the store helper, and the active/retired ball distinction comes from the
 * arsenal store. The selected ball DEFAULTS TO THE LAST-USED one: once you pick
 * a ball it stays selected for subsequent throws until you change it.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BallPicker } from '../arsenal/BallPicker';
import { legalNextPins } from './store';

interface FrameInputProps {
  readonly frames: number[][];
  readonly currentFrame: number;
  readonly onRecord: (pins: number, ballId?: string | null) => void;
  readonly disabled?: boolean;
}

const ALL_PINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Label a pin count (10 shows as "X" for a strike-able throw). */
function pinLabel(pins: number): string {
  return pins === 10 ? 'X' : String(pins);
}

export function FrameInput({
  frames,
  currentFrame,
  onRecord,
  disabled = false,
}: FrameInputProps): React.JSX.Element {
  const legal = new Set(legalNextPins({ frames, currentFrame }));
  // Last-used ball persists across throws until changed (null = untagged).
  const [selectedBallId, setSelectedBallId] = useState<string | null>(null);

  return (
    <View>
      <BallPicker selectedBallId={selectedBallId} onSelect={setSelectedBallId} />
      <View className="flex-row flex-wrap justify-center gap-2 p-4">
        {ALL_PINS.map((pins) => {
          const isDisabled = disabled || !legal.has(pins);
          return (
            <Pressable
              key={pins}
              accessibilityRole="button"
              accessibilityState={{ disabled: isDisabled }}
              disabled={isDisabled}
              onPress={() => onRecord(pins, selectedBallId)}
              className={
                isDisabled
                  ? 'h-12 w-12 items-center justify-center rounded-lg bg-gray-200'
                  : 'h-12 w-12 items-center justify-center rounded-lg bg-blue-600'
              }
            >
              <Text
                className={
                  isDisabled
                    ? 'text-base font-semibold text-gray-400'
                    : 'text-base font-semibold text-white'
                }
              >
                {pinLabel(pins)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
