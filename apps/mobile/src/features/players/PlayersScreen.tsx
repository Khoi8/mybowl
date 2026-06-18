/**
 * Contacts list screen — the persistent identities you bowl with.
 *
 * Thin: loads the contact list from the shared store on mount and renders it,
 * with the reuse-first `AddPlayerSheet` for adding people. The per-contact
 * "bowled with N" relational summary is S15 (relational stats); a placeholder
 * line marks where it lands. NO business logic here.
 */
import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { getDb } from '../../db/client';
import type { Player } from '../../db/schema';
import { AddPlayerSheet } from './AddPlayerSheet';
import { usePlayers } from './usePlayers';

export function PlayersScreen(): React.JSX.Element {
  const { players, load, removePlayer } = usePlayers();

  useEffect(() => {
    load(getDb());
  }, [load]);

  return (
    <View className="flex-1 bg-white">
      <AddPlayerSheet onPicked={() => undefined} />

      <FlatList
        data={players}
        keyExtractor={(p: Player) => p.id}
        ListEmptyComponent={
          <Text className="p-4 text-sm text-gray-500">
            No contacts yet. Add the people you bowl with above.
          </Text>
        }
        renderItem={({ item }: { item: Player }) => (
          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
            <View>
              <Text className="text-base text-gray-900">
                {item.name}
                {item.isSelf ? ' (you)' : ''}
              </Text>
              {/* S15: replace with real head-to-head "bowled with N times". */}
              <Text className="text-xs text-gray-400">bowled with — times</Text>
            </View>
            {item.isSelf ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={() => removePlayer(getDb(), item.id)}
                className="rounded-lg bg-gray-100 px-3 py-1"
              >
                <Text className="text-sm text-gray-600">Remove</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}
