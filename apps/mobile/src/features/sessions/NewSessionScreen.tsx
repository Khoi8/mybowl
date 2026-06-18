/**
 * New session screen — create an outing (solo or group) and add participants.
 *
 * Thin: all logic lives in the RN-free sessions store and the contacts store.
 * The screen encodes the ONE-CODE-PATH rule from CLAUDE.md §5/§6/§11: a solo
 * session is just the degenerate one-participant case. The user toggles "Group
 * session?"; either way the session is created via the SAME `createSession`,
 * and participants are added via the SAME `addParticipant`. The self player is
 * always the first participant; `AddPlayerSheet` (S11, reuse-first) adds more.
 *
 * Identity: a game's `ownerUserId` is the recording account — taken from the
 * self player's `userId`. The self player must already exist (created on the
 * Players screen, S11); if it does not, we point the user there rather than
 * minting auth state here (Cognito is parked).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { getDb } from '../../db/client';
import type { RootStackParamList } from '../../app/navigation';
import type { Player } from '../../db/schema';
import { AddPlayerSheet } from '../players/AddPlayerSheet';
import { usePlayers } from '../players/usePlayers';
import { useSession } from './useSession';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession' | 'Sessions'>;

/** Today's date as ISO `YYYY-MM-DD` for stamping the session. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewSessionScreen({ navigation }: Props): React.JSX.Element {
  const { players, load } = usePlayers();
  const { createSession, addParticipant } = useSession();

  const [isGroup, setIsGroup] = useState(false);
  const [participants, setParticipants] = useState<readonly Player[]>([]);

  useEffect(() => {
    load(getDb());
  }, [load]);

  const self = useMemo(() => players.find((p) => p.isSelf), [players]);

  const addPicked = (player: Player): void => {
    setParticipants((prev) =>
      prev.some((p) => p.id === player.id) ? prev : [...prev, player],
    );
  };

  const onStart = (): void => {
    if (self?.userId == null) return;
    const db = getDb();
    // ONE code path: same createSession for solo and group; isGroup is metadata.
    const session = createSession(db, {
      ownerUserId: self.userId,
      date: today(),
      isGroup,
    });
    // Self is always the first participant; a solo session has only this one.
    addParticipant(db, session.id, self.id, 1);
    participants.forEach((p, i) => addParticipant(db, session.id, p.id, i + 2));
    navigation.navigate('Session', { sessionId: session.id });
  };

  if (self?.userId == null) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6">
        <Text className="text-center text-sm text-gray-500">
          Add yourself as a contact first.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Players')}
          className="mt-4 rounded-lg bg-green-600 px-4 py-2"
        >
          <Text className="font-semibold text-white">Go to contacts</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-base text-gray-900">Group session?</Text>
        <Switch value={isGroup} onValueChange={setIsGroup} />
      </View>

      <View className="px-4 py-2">
        <Text className="text-xs font-semibold uppercase text-gray-500">
          Participants
        </Text>
        <Text className="py-1 text-base text-gray-900">{self.name} (you)</Text>
        {participants.map((p) => (
          <Text key={p.id} className="py-1 text-base text-gray-900">
            {p.name}
          </Text>
        ))}
      </View>

      {isGroup ? <AddPlayerSheet onPicked={addPicked} /> : null}

      <View className="p-4">
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          className="rounded-lg bg-green-600 px-4 py-3"
        >
          <Text className="text-center font-semibold text-white">
            {isGroup ? 'Start group session' : 'Start solo session'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
