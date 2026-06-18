/**
 * Session screen — a single outing: its participants and each participant's
 * games (their series for that outing).
 *
 * Thin: it loads the session + grouped games from the RN-free store and the
 * contacts list (for name resolution), then launches scoring entry per
 * participant. The KEY S12 behaviour — context inheritance — is realized by
 * passing `gameMetaFor(session, playerId)` through to the `Score` route, so the
 * committed game inherits the session's location/lane/oil-pattern. Solo and
 * group go through this same screen (a solo session just has one participant).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getDb } from '../../db/client';
import type { RootStackParamList } from '../../app/navigation';
import type { Session } from '../../db/schema';
import { getSessionById } from '../../db/repositories/sessions';
import { LaneConditionForm } from '../laneConditions/LaneConditionForm';
import { usePlayers } from '../players/usePlayers';
import { ParticipantList } from './ParticipantList';
import type { ParticipantGames } from './store';
import { useSession } from './useSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Session'>;

export function SessionScreen({ route, navigation }: Props): React.JSX.Element {
  const { sessionId } = route.params;
  const { gameMetaFor, listSessionGamesByPlayer } = useSession();
  const { players, load } = usePlayers();

  const [session, setSession] = useState<Session | undefined>(undefined);
  const [groups, setGroups] = useState<readonly ParticipantGames[]>([]);
  const [showLaneForm, setShowLaneForm] = useState(false);

  useEffect(() => {
    const db = getDb();
    load(db);
    setSession(getSessionById(db, sessionId));
    setGroups(listSessionGamesByPlayer(db, sessionId));
  }, [sessionId, load, listSessionGamesByPlayer]);

  const nameFor = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p.name]));
    return (playerId: string): string => byId.get(playerId) ?? 'Unknown';
  }, [players]);

  const onScore = (playerId: string): void => {
    if (session === undefined) return;
    // Context inheritance: the meta carries the session's location/lane/oil.
    const meta = gameMetaFor(session, playerId);
    navigation.navigate('Score', {
      ownerUserId: meta.ownerUserId,
      playerId: meta.playerId,
      sessionId: meta.sessionId,
      date: meta.date,
      locationId: meta.locationId,
      lane: meta.lane,
      oilPatternId: meta.oilPatternId,
    });
  };

  if (session === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-sm text-gray-500">Session not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-4 py-3">
        <Text className="text-lg font-semibold text-gray-900">
          {session.isGroup ? 'Group session' : 'Solo session'}
        </Text>
        <Text className="text-xs text-gray-400">
          {session.date}
          {session.lane !== null ? ` · ${session.lane}` : ''}
        </Text>
      </View>

      <ParticipantList groups={groups} nameFor={nameFor} onScore={onScore} />

      {session.locationId !== null ? (
        <View className="border-t border-gray-100 px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showLaneForm }}
            onPress={() => setShowLaneForm((prev) => !prev)}
            className="rounded-lg border border-gray-300 px-4 py-2"
          >
            <Text className="text-center font-semibold text-gray-700">
              {showLaneForm ? 'Hide lane conditions' : 'Log lane conditions'}
            </Text>
          </Pressable>
          {showLaneForm ? (
            <LaneConditionForm
              ownerUserId={session.ownerUserId}
              locationId={session.locationId}
              sessionId={session.id}
              date={session.date}
              onLogged={() => setShowLaneForm(false)}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
