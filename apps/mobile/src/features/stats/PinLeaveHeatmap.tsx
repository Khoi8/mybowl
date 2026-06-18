/**
 * Pin-leave heatmap — renders the `aggregatePinLeaves` map (pin → how many
 * frames left it standing) as a bowling pin deck, each pin shaded by its
 * standing-count relative to the most-left pin. Thin: NO logic beyond mapping a
 * count to an opacity bucket for display.
 *
 * Deck layout (rows back→front), matching how a rack faces the bowler:
 *   row 4:  7  8  9  10
 *   row 3:    4  5  6
 *   row 2:      2  3
 *   row 1:        1
 */
import { Text, View } from 'react-native';

/** Pin numbers per deck row, back row first. */
const PIN_ROWS: readonly (readonly number[])[] = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];

/** Tailwind background buckets from cool (rarely left) to hot (often left). */
const SHADES = [
  'bg-gray-100',
  'bg-amber-100',
  'bg-amber-200',
  'bg-orange-300',
  'bg-orange-500',
] as const;

/** Map a pin's count to a shade bucket, scaled against the deck's max count. */
function shadeFor(count: number, max: number): string {
  if (max === 0 || count === 0) return SHADES[0];
  // Buckets 1..4 (index into SHADES) by fraction of the max.
  const ratio = count / max;
  const bucket = Math.min(SHADES.length - 1, Math.ceil(ratio * (SHADES.length - 1)));
  return SHADES[bucket] ?? SHADES[0];
}

export function PinLeaveHeatmap({
  heatmap,
}: {
  readonly heatmap: Record<number, number>;
}): React.JSX.Element {
  const max = Math.max(0, ...Object.values(heatmap));

  return (
    <View className="items-center py-2">
      {PIN_ROWS.map((row, r) => (
        <View key={r} className="flex-row justify-center">
          {row.map((pin) => {
            const count = heatmap[pin] ?? 0;
            return (
              <View
                key={pin}
                accessibilityLabel={`Pin ${pin} left standing ${count} times`}
                className={`m-1 h-9 w-9 items-center justify-center rounded-full border border-gray-200 ${shadeFor(
                  count,
                  max,
                )}`}
              >
                <Text className="text-[10px] font-semibold text-gray-700">{pin}</Text>
                <Text className="text-[9px] text-gray-500">{count}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
