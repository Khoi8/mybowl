/**
 * Manual frame-by-frame scoring entry screen. Thin: it wires the RN-free store
 * (via `useScoreEntry`) to the pin pad + scorecard, surfaces validation errors,
 * and commits to SQLite offline-first on finish. All scoring/validation/
 * persistence logic lives in the domain, the store, and the repos.
 *
 * `ownerUserId` / `playerId` (and optional session context) arrive as route
 * params: a solo game is the one-participant degenerate case, so the same screen
 * serves both — the caller (sessions slice, S12) supplies whose game this is.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, Text, View } from 'react-native';

import { getDb } from '../../db/client';
import type { RootStackParamList } from '../../app/navigation';
import { FrameInput } from './FrameInput';
import { Scorecard } from './Scorecard';
import { useScoreEntry } from './useScoreEntry';

type Props = NativeStackScreenProps<RootStackParamList, 'Score'>;

/** Today's date as ISO `YYYY-MM-DD` for stamping the game. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ScoreEntryScreen({ route, navigation }: Props): React.JSX.Element {
  const { ownerUserId, playerId, sessionId } = route.params;
  const {
    frames,
    currentFrame,
    lastError,
    recordThrow,
    undoLastThrow,
    reset,
    scored,
    commit,
  } = useScoreEntry();

  const result = scored();

  const onSave = (): void => {
    // Offline-first: write straight to SQLite; the repo enqueues the sync op.
    commit(getDb(), { ownerUserId, playerId, date: today(), sessionId });
    navigation.goBack();
  };

  return (
    <View className="flex-1 bg-white">
      <Scorecard scored={result} currentFrame={currentFrame} />

      <View className="flex-1 items-center justify-center">
        <Text className="text-3xl font-bold">{result.total}</Text>
        <Text className="text-sm text-gray-500">
          {result.isComplete ? 'Final' : `Frame ${Math.min(currentFrame + 1, 10)}`}
        </Text>
        {lastError !== null ? (
          <Text className="mt-2 text-sm text-red-600">{lastError}</Text>
        ) : null}
      </View>

      <FrameInput
        frames={frames}
        currentFrame={currentFrame}
        onRecord={recordThrow}
        disabled={result.isComplete}
      />

      <View className="flex-row justify-around p-4">
        <Pressable
          accessibilityRole="button"
          onPress={undoLastThrow}
          className="rounded-lg bg-gray-200 px-4 py-2"
        >
          <Text className="font-semibold text-gray-800">Undo</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={reset}
          className="rounded-lg bg-gray-200 px-4 py-2"
        >
          <Text className="font-semibold text-gray-800">Reset</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!result.isComplete}
          onPress={onSave}
          className={
            result.isComplete
              ? 'rounded-lg bg-green-600 px-4 py-2'
              : 'rounded-lg bg-gray-200 px-4 py-2'
          }
        >
          <Text
            className={
              result.isComplete
                ? 'font-semibold text-white'
                : 'font-semibold text-gray-400'
            }
          >
            Save game
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
