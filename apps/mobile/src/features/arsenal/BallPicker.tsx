/**
 * Ball picker — horizontal chips of the ACTIVE arsenal for per-throw tagging.
 *
 * Thin: it renders `useArsenal().activeBalls()` (retired balls are excluded by
 * the store selector, so they never offer for new entry) plus an "Untagged"
 * chip. NO business logic here — the active/retired distinction lives in the
 * store. The parent (FrameInput) owns the selected ball and passes it down.
 */
import { Pressable, ScrollView, Text } from 'react-native';

import type { Ball } from '../../db/schema';
import { useArsenal } from './useArsenal';

interface BallPickerProps {
  /** Currently selected ball id, or null for untagged. */
  readonly selectedBallId: string | null;
  /** Called when the user picks a ball (null = untagged). */
  readonly onSelect: (ballId: string | null) => void;
}

export function BallPicker({
  selectedBallId,
  onSelect,
}: BallPickerProps): React.JSX.Element {
  const { activeBalls } = useArsenal();
  const balls = activeBalls();

  const chipClass = (active: boolean): string =>
    active
      ? 'mr-2 rounded-full bg-blue-600 px-3 py-1'
      : 'mr-2 rounded-full bg-gray-200 px-3 py-1';
  const textClass = (active: boolean): string =>
    active ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-gray-700';

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selectedBallId === null }}
        onPress={() => onSelect(null)}
        className={chipClass(selectedBallId === null)}
      >
        <Text className={textClass(selectedBallId === null)}>Untagged</Text>
      </Pressable>
      {balls.map((b: Ball) => {
        const active = b.id === selectedBallId;
        return (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(b.id)}
            className={chipClass(active)}
          >
            <Text className={textClass(active)}>{b.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
