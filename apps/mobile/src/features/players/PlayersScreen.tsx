/**
 * Contacts list screen — the persistent identities you bowl with.
 *
 * Thin: loads the contact list from the shared store on mount and renders it,
 * with the reuse-first `AddPlayerSheet` for adding people. Tapping a contact
 * opens their relational ("head-to-head") stats (S15) — the self player is the
 * `isSelf` row already in the loaded list, so no extra lookup. NO business
 * logic here.
 */
import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../app/navigation';
import { getDb } from '../../db/client';
import type { Player } from '../../db/schema';
import { AddPlayerSheet } from './AddPlayerSheet';
import { usePlayers } from './usePlayers';

type Props = NativeStackScreenProps<RootStackParamList, 'Players'>;

export function PlayersScreen({ navigation }: Props): React.JSX.Element {
  const { players, load, removePlayer } = usePlayers();

  useEffect(() => {
    load(getDb());
  }, [load]);

  // The self player is the single `isSelf` contact in the loaded list; we need
  // it to anchor a head-to-head view against any other contact.
  const self = players.find((p) => p.isSelf);

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
        renderItem={({ item }: { item: Player }) => {
          // A non-self contact is tappable for head-to-head once a self exists.
          const canViewH2H = !item.isSelf && self !== undefined;
          return (
            <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
              <Pressable
                accessibilityRole={canViewH2H ? 'button' : undefined}
                disabled={!canViewH2H}
                onPress={
                  canViewH2H && self !== undefined
                    ? () =>
                        navigation.navigate('Relational', {
                          selfPlayerId: self.id,
                          opponentPlayerId: item.id,
                          opponentName: item.name,
                        })
                    : undefined
                }
                className="flex-1"
              >
                <Text className="text-base text-gray-900">
                  {item.name}
                  {item.isSelf ? ' (you)' : ''}
                </Text>
                <Text className="text-xs text-gray-400">
                  {item.isSelf ? 'this is you' : 'tap for head-to-head'}
                </Text>
              </Pressable>
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
          );
        }}
      />
    </View>
  );
}
