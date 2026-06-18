/**
 * Pin-count entry pad. Renders buttons 0..10; buttons whose pin count is illegal
 * for the next throw (per `legalNextPins`, which delegates to `validateFrame`)
 * are disabled. NO business logic here — legality comes from the store helper.
 */
import { Pressable, Text, View } from 'react-native';

import { legalNextPins } from './store';

interface FrameInputProps {
  readonly frames: number[][];
  readonly currentFrame: number;
  readonly onRecord: (pins: number) => void;
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

  return (
    <View className="flex-row flex-wrap justify-center gap-2 p-4">
      {ALL_PINS.map((pins) => {
        const isDisabled = disabled || !legal.has(pins);
        return (
          <Pressable
            key={pins}
            accessibilityRole="button"
            accessibilityState={{ disabled: isDisabled }}
            disabled={isDisabled}
            onPress={() => onRecord(pins)}
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
  );
}
