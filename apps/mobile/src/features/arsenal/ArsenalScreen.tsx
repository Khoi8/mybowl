/**
 * Arsenal screen — manage the balls you bowl with.
 *
 * Thin: loads the arsenal for the self player's account on mount and renders it,
 * with `BallForm` for adding. RETIRE vs REMOVE (CLAUDE.md §6) is surfaced as two
 * actions: "Retire" keeps the ball in this list (history) but hides it from new
 * per-throw tagging; "Remove" tombstones it. Retired balls are shown greyed with
 * an "Un-retire" action. NO business logic here — it all lives in the store.
 *
 * Identity: `ownerUserId` is the self player's `userId` (the recording account),
 * mirroring the sessions/scoring slices. The self player must already exist
 * (created on the Players screen, S11); if not, we point the user there.
 */
import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { getDb } from '../../db/client';
import type { Ball } from '../../db/schema';
import { usePlayers } from '../players/usePlayers';
import { BallForm } from './BallForm';
import { useArsenal } from './useArsenal';

export function ArsenalScreen(): React.JSX.Element {
  const { players, load: loadPlayers } = usePlayers();
  const { allBalls, load, retire, unretire, remove } = useArsenal();

  const self = useMemo(() => players.find((p) => p.isSelf), [players]);
  const ownerUserId = self?.userId ?? null;

  useEffect(() => {
    loadPlayers(getDb());
  }, [loadPlayers]);

  useEffect(() => {
    if (ownerUserId !== null) load(getDb(), ownerUserId);
  }, [ownerUserId, load]);

  if (ownerUserId === null) {
    return (
      <View className="flex-1 items-center justify-center p-4">
        <Text className="text-center text-sm text-gray-500">
          Create your self player on the Players screen first — your arsenal is tied to
          your account.
        </Text>
      </View>
    );
  }

  const balls = allBalls();

  return (
    <View className="flex-1 bg-white">
      <BallForm ownerUserId={ownerUserId} />

      <FlatList
        data={balls}
        keyExtractor={(b: Ball) => b.id}
        ListEmptyComponent={
          <Text className="p-4 text-sm text-gray-500">
            No balls yet. Add the equipment you bowl with above.
          </Text>
        }
        renderItem={({ item }: { item: Ball }) => (
          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
            <View>
              <Text
                className={
                  item.retired ? 'text-base text-gray-400' : 'text-base text-gray-900'
                }
              >
                {item.name}
                {item.retired ? ' (retired)' : ''}
              </Text>
              {item.brand !== null ? (
                <Text className="text-xs text-gray-400">{item.brand}</Text>
              ) : null}
            </View>
            <View className="flex-row gap-2">
              {item.retired ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => unretire(getDb(), item.id)}
                  className="rounded-lg bg-gray-100 px-3 py-1"
                >
                  <Text className="text-sm text-gray-600">Un-retire</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => retire(getDb(), item.id)}
                  className="rounded-lg bg-gray-100 px-3 py-1"
                >
                  <Text className="text-sm text-gray-600">Retire</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => remove(getDb(), item.id)}
                className="rounded-lg bg-gray-100 px-3 py-1"
              >
                <Text className="text-sm text-gray-600">Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}
