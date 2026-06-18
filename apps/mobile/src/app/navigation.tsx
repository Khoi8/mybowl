/**
 * Navigation skeleton: a native-stack wiring the MVP feature-slice screens
 * (Sessions, Stats, Arsenal, Players, Score). Intentionally thin — NO business
 * logic here. Each screen lives in its feature slice (`features/sessions`,
 * `features/stats`, `features/arsenal`, …).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScoreEntryScreen } from '../features/scoring/ScoreEntryScreen';
import { PlayersScreen } from '../features/players/PlayersScreen';
import { SessionScreen } from '../features/sessions/SessionScreen';
import { NewSessionScreen } from '../features/sessions/NewSessionScreen';
import { ArsenalScreen } from '../features/arsenal/ArsenalScreen';
import { SoloStatsScreen } from '../features/stats/SoloStatsScreen';
import { RelationalStatsScreen } from '../features/stats/relational/RelationalStatsScreen';

/** Route name → params map. Widened per-slice as features land. */
export type RootStackParamList = {
  Sessions: undefined;
  /** Solo stats for one bowler — `playerId` is whose stats to recompute. */
  Stats: { playerId: string };
  /**
   * Relational ("head-to-head") stats between the self player and one opponent.
   * `opponentName` is carried for the "you've bowled with <name> N times"
   * headline so the screen needn't reload the contact list. All math keys on
   * the two ids (a guest opponent behaves identically to a linked one).
   */
  Relational: { selfPlayerId: string; opponentPlayerId: string; opponentName: string };
  Arsenal: undefined;
  /** Persistent contacts you bowl with (self + guests + linked accounts). */
  Players: undefined;
  /** Create an outing (solo or group) + add participants. */
  NewSession: undefined;
  /** A single outing: participants and their games. */
  Session: { sessionId: string };
  /**
   * Manual scoring entry. The caller (a session/solo flow, S12) supplies whose
   * game this is — `ownerUserId` is the recording account, `playerId` is the
   * bowler. `sessionId` is omitted/null for a solo game. The session's context
   * (`locationId`/`lane`/`oilPatternId`) is INHERITED here and stamped onto the
   * committed game — the screen never re-types it.
   */
  Score: {
    ownerUserId: string;
    playerId: string;
    sessionId?: string | null;
    date?: string;
    locationId?: string | null;
    lane?: string | null;
    oilPatternId?: string | null;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Root navigator mounted under the provider tree. */
export function RootNavigation(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Sessions">
          <Stack.Screen
            name="Sessions"
            component={NewSessionScreen}
            options={{ title: 'New session' }}
          />
          <Stack.Screen name="NewSession" component={NewSessionScreen} />
          <Stack.Screen name="Session" component={SessionScreen} />
          <Stack.Screen
            name="Stats"
            component={SoloStatsScreen}
            options={{ title: 'Stats' }}
          />
          <Stack.Screen
            name="Relational"
            component={RelationalStatsScreen}
            options={{ title: 'Head-to-head' }}
          />
          <Stack.Screen name="Arsenal" component={ArsenalScreen} />
          <Stack.Screen name="Players" component={PlayersScreen} />
          <Stack.Screen name="Score" component={ScoreEntryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
