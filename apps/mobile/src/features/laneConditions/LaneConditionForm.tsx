/**
 * Log-lane-conditions form — minimal per-visit lane condition entry.
 *
 * Thin: it binds the condition fields and writes ONE log tied to a specific
 * visit (`sessionId`) at a `locationId`. All persistence (sync stamping) lives
 * in the RN-free store. NO business logic here. PER-VISIT (CLAUDE.md §6/§11):
 * each submit creates a NEW log for this visit — it never edits "the location's
 * condition." The `ownerUserId`/`locationId`/`sessionId` are supplied by the
 * parent (the active SessionScreen); this form never mints them.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getDb } from '../../db/client';
import type { LaneFreshness } from '../../db/repositories/laneConditions';
import { useLaneConditions } from './useLaneConditions';

interface LaneConditionFormProps {
  /** Recording account that owns the log. */
  readonly ownerUserId: string;
  /** Where the outing is — required (a log is always tied to a location). */
  readonly locationId: string;
  /** Which visit this log belongs to. */
  readonly sessionId: string;
  /** Session date the log inherits by default. */
  readonly date: string;
  /** Optional callback after a successful log (e.g. to dismiss the sheet). */
  readonly onLogged?: () => void;
}

const FRESHNESS_OPTIONS: readonly { value: LaneFreshness; label: string }[] = [
  { value: 'fresh', label: 'Fresh' },
  { value: 'broken_down', label: 'Broken down' },
  { value: 'burnt', label: 'Burnt' },
];

const RATINGS: readonly number[] = [1, 2, 3, 4, 5];

export function LaneConditionForm({
  ownerUserId,
  locationId,
  sessionId,
  date,
  onLogged,
}: LaneConditionFormProps): React.JSX.Element {
  const { logForSession } = useLaneConditions();
  const [freshness, setFreshness] = useState<LaneFreshness | null>(null);
  const [playStyle, setPlayStyle] = useState('');
  const [carrydown, setCarrydown] = useState('');
  const [holdNotes, setHoldNotes] = useState('');
  const [breakpointNotes, setBreakpointNotes] = useState('');
  const [rating, setRating] = useState<number | null>(null);

  const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

  const onLog = (): void => {
    logForSession(getDb(), {
      ownerUserId,
      locationId,
      sessionId,
      date,
      freshness,
      playStyle: orNull(playStyle),
      carrydown: orNull(carrydown),
      holdNotes: orNull(holdNotes),
      breakpointNotes: orNull(breakpointNotes),
      rating1to5: rating,
    });
    setFreshness(null);
    setPlayStyle('');
    setCarrydown('');
    setHoldNotes('');
    setBreakpointNotes('');
    setRating(null);
    onLogged?.();
  };

  return (
    <View className="gap-3 p-4">
      <Text className="text-base font-semibold text-gray-900">Lane conditions</Text>

      <Text className="text-xs font-medium text-gray-500">Freshness</Text>
      <View className="flex-row gap-2">
        {FRESHNESS_OPTIONS.map((opt) => {
          const selected = freshness === opt.value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFreshness(selected ? null : opt.value)}
              className={
                selected
                  ? 'rounded-full bg-blue-600 px-3 py-1'
                  : 'rounded-full border border-gray-300 px-3 py-1'
              }
            >
              <Text className={selected ? 'text-sm text-white' : 'text-sm text-gray-700'}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Play style (e.g. play deep, swing out)"
        value={playStyle}
        onChangeText={setPlayStyle}
      />
      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Carrydown"
        value={carrydown}
        onChangeText={setCarrydown}
      />
      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Hold notes"
        value={holdNotes}
        onChangeText={setHoldNotes}
      />
      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Breakpoint notes"
        value={breakpointNotes}
        onChangeText={setBreakpointNotes}
      />

      <Text className="text-xs font-medium text-gray-500">Rating</Text>
      <View className="flex-row gap-2">
        {RATINGS.map((n) => {
          const selected = rating === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setRating(selected ? null : n)}
              className={
                selected
                  ? 'h-9 w-9 items-center justify-center rounded-full bg-blue-600'
                  : 'h-9 w-9 items-center justify-center rounded-full border border-gray-300'
              }
            >
              <Text className={selected ? 'text-sm text-white' : 'text-sm text-gray-700'}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onLog}
        className="rounded-lg bg-blue-600 px-4 py-2"
      >
        <Text className="text-center font-semibold text-white">Log lane conditions</Text>
      </Pressable>
    </View>
  );
}
