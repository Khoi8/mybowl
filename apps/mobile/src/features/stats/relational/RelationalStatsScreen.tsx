/**
 * Relational ("head-to-head") stats screen — how the self player stacks up
 * against, and bowls alongside, one opponent. Thin: it reads recomputed stats
 * from `useHeadToHead` (which derives everything live from session/game/frame
 * data — nothing is stored, CLAUDE.md §5/§8) and renders them. NO business
 * logic here.
 *
 * The headline "You've bowled with <name> N times" comes from `timesBowledWith`
 * (shared sessions with a real head-to-head), NOT `withWithout.sessionsWith` —
 * per the S8 review note. Surfacing N makes identity fragmentation visible: if
 * you keep minting a new "Mike" each visit, N stays low and the stats never
 * accumulate (the crux of CLAUDE.md §8).
 *
 * Null handling: every ratio/average is `null` when its denominator is 0 (no
 * shared history) — the domain never emits NaN. The screen shows "—" for a null
 * value and an explicit empty-state when there's no shared history at all.
 */
import { ScrollView, Text, View } from 'react-native';

import type { RootStackParamList } from '../../../app/navigation';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeadToHead } from './useHeadToHead';

type Props = NativeStackScreenProps<RootStackParamList, 'Relational'>;

/** Render an integer-ish average or "—" when null (no paired games). */
function fmtNum(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}`;
}

/** Render a signed margin (e.g. "+12" / "-7") or "—" when null. */
function fmtMargin(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** Render a percentage ratio (0-100) or "—" when there's no data (null). */
function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
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

/** Section header. */
function SectionLabel({ children }: { readonly children: string }) {
  return (
    <Text className="px-4 pb-1 pt-5 text-xs uppercase tracking-wide text-gray-400">
      {children}
    </Text>
  );
}

export function RelationalStatsScreen({ route }: Props): React.JSX.Element {
  const { selfPlayerId, opponentPlayerId, opponentName } = route.params;
  const { data, isPending, isError } = useHeadToHead(selfPlayerId, opponentPlayerId);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-sm text-gray-500">Loading head-to-head…</Text>
      </View>
    );
  }

  if (isError || data === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-sm text-gray-500">Couldn’t load head-to-head.</Text>
      </View>
    );
  }

  const { record, withWithout, timesBowledWith } = data;

  // Headline N is sourced from timesBowledWith (NOT withWithout.sessionsWith).
  const headline =
    timesBowledWith === 0
      ? `You haven’t bowled with ${opponentName} yet`
      : `You’ve bowled with ${opponentName} ${timesBowledWith} time${
          timesBowledWith === 1 ? '' : 's'
        }`;

  // No shared head-to-head history at all — encourage reusing the same contact.
  if (timesBowledWith === 0) {
    return (
      <ScrollView className="flex-1 bg-white">
        <Text className="px-4 pt-5 text-lg font-semibold text-gray-900">{headline}</Text>
        <Text className="px-4 pt-2 text-sm leading-5 text-gray-500">
          Bowl a group session with {opponentName} to start tracking your head-to-head
          record and whether you bowl better together. Reuse the same contact each visit
          so these stats accumulate — a fresh contact each time fragments the history.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <Text className="px-4 pt-5 text-lg font-semibold text-gray-900">{headline}</Text>

      <SectionLabel>Head-to-head record</SectionLabel>
      <StatRow
        label="Record (W–L–T)"
        value={`${record.wins}–${record.losses}–${record.ties}`}
      />
      <StatRow label="Games compared" value={`${record.gamesPaired}`} />
      <StatRow label="Avg margin (you − them)" value={fmtMargin(record.avgMargin)} />
      <StatRow label="Your avg (these games)" value={fmtNum(record.selfAvg)} />
      <StatRow label="Their avg (these games)" value={fmtNum(record.opponentAvg)} />

      <Text className="px-4 py-2 text-xs leading-4 text-gray-400">
        Games are paired in order within each shared session; if one of you bowled more
        games, the extra games don’t count toward the record.
      </Text>

      <SectionLabel>Do you bowl better together?</SectionLabel>
      <StatRow
        label={`Your avg with ${opponentName}`}
        value={fmtNum(withWithout.withAvg)}
      />
      <StatRow
        label={`Your avg without ${opponentName}`}
        value={fmtNum(withWithout.withoutAvg)}
      />
      <StatRow label="Your strike % together" value={fmtPct(withWithout.withStrikePct)} />
      <StatRow label="Your strike % apart" value={fmtPct(withWithout.withoutStrikePct)} />
      <StatRow
        label="Sessions with / without"
        value={`${withWithout.sessionsWith} / ${withWithout.sessionsWithout}`}
      />

      <Text className="px-4 py-2 text-xs leading-4 text-gray-400">
        “With” averages your games from sessions where {opponentName} also bowled;
        “without” averages your other group sessions. “—” means no games on that side yet.
      </Text>
    </ScrollView>
  );
}
