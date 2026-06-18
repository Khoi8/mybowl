/**
 * Solo stats screen — whole-career averages, highs, and rate stats for a
 * player, plus a pin-leave heatmap. Thin: it reads recomputed stats from
 * `useSoloStats` (which derives everything live from frame data — nothing is
 * stored, CLAUDE.md §5) and renders them. NO business logic here.
 *
 * Null handling: every ratio is `null` when its denominator is 0 (no data) —
 * the domain never emits NaN. The screen shows "—" for a null ratio / missing
 * average rather than a misleading 0.
 */
import { ScrollView, Text, View } from 'react-native';

import type { RootStackParamList } from '../../app/navigation';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PinLeaveHeatmap } from './PinLeaveHeatmap';
import { useSoloStats } from './useSoloStats';

type Props = NativeStackScreenProps<RootStackParamList, 'Stats'>;

/** Render a percentage ratio (0-100) or "—" when there's no data (null). */
function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/** Render an integer-ish number or "—" when null (empty history). */
function fmtNum(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}`;
}

/** One label/value stat row. */
function StatRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
      <Text className="text-base text-gray-600">{label}</Text>
      <Text className="text-base font-semibold text-gray-900">{value}</Text>
    </View>
  );
}

export function SoloStatsScreen({ route }: Props): React.JSX.Element {
  // `playerId` is supplied by the caller (the self-player for solo stats).
  const playerId = route.params.playerId;
  const { data, isPending, isError } = useSoloStats(playerId);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-sm text-gray-500">Loading stats…</Text>
      </View>
    );
  }

  if (isError || data === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-sm text-gray-500">Couldn’t load stats.</Text>
      </View>
    );
  }

  const { series, heatmap } = data;

  return (
    <ScrollView className="flex-1 bg-white">
      <Text className="px-4 pb-1 pt-4 text-xs uppercase tracking-wide text-gray-400">
        {series.gameCount === 0
          ? 'No games yet'
          : `${series.gameCount} game${series.gameCount === 1 ? '' : 's'}`}
      </Text>

      <StatRow label="Average" value={fmtNum(series.average)} />
      <StatRow label="High game" value={fmtNum(series.highGame)} />
      <StatRow label="High series" value={fmtNum(series.highSeries)} />
      <StatRow label="Strike %" value={fmtPct(series.strikePct)} />
      <StatRow label="Spare conversion %" value={fmtPct(series.spareConversionPct)} />
      <StatRow label="Split conversion %" value={fmtPct(series.splitConversionPct)} />
      <StatRow label="Single-pin spare %" value={fmtPct(series.singlePinSparePct)} />
      <StatRow label="Clean games" value={`${series.cleanGameCount}`} />

      <Text className="px-4 py-2 text-xs leading-4 text-gray-400">
        Strike % counts each fresh-rack ball as a first-ball opportunity — including bonus
        balls in the 10th frame that follow a cleared rack — so a perfect game is 100%.
      </Text>

      <View className="px-4 pb-2 pt-4">
        <Text className="pb-2 text-xs uppercase tracking-wide text-gray-400">
          Pin leaves
        </Text>
        <PinLeaveHeatmap heatmap={heatmap} />
      </View>
    </ScrollView>
  );
}
