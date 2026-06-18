/**
 * Participant list for a session — each participant and (optionally) the count
 * of games they have bowled this outing (their series so far).
 *
 * Thin/presentational: it resolves a participant's player id to a contact name
 * via the passed-in `playersById` map (the caller owns loading contacts) and
 * fires `onScore` when the user wants to record another game for that bowler.
 * No business logic here — grouping is done in the RN-free store.
 */
import { Pressable, Text, View } from 'react-native';

import type { ParticipantGames } from './store';

interface ParticipantListProps {
  readonly groups: readonly ParticipantGames[];
  /** Resolve a playerId to a display name (from the contacts store). */
  readonly nameFor: (playerId: string) => string;
  /** Start a new game for the given participant (launches scoring entry). */
  readonly onScore: (playerId: string) => void;
}

export function ParticipantList({
  groups,
  nameFor,
  onScore,
}: ParticipantListProps): React.JSX.Element {
  return (
    <View>
      {groups.map(({ participant, games }) => (
        <View
          key={participant.id}
          className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3"
        >
          <View>
            <Text className="text-base text-gray-900">
              {nameFor(participant.playerId)}
            </Text>
            <Text className="text-xs text-gray-400">
              {games.length === 1 ? '1 game' : `${games.length} games`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onScore(participant.playerId)}
            className="rounded-lg bg-green-600 px-3 py-1"
          >
            <Text className="text-sm font-semibold text-white">Score game</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
