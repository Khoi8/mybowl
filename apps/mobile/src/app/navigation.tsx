/**
 * Navigation skeleton: a native-stack with placeholder screens for the three
 * top-level areas the MVP feature slices will fill in (Sessions, Stats,
 * Arsenal). Intentionally thin — NO business logic here. Real screens land in
 * their feature slices (`features/sessions`, `features/stats`,
 * `features/arsenal`) in later slices and replace these placeholders.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';

import { ScoreEntryScreen } from '../features/scoring/ScoreEntryScreen';
import { PlayersScreen } from '../features/players/PlayersScreen';

/** Route name → params map. Widened per-slice as features land. */
export type RootStackParamList = {
  Sessions: undefined;
  Stats: undefined;
  Arsenal: undefined;
  /** Persistent contacts you bowl with (self + guests + linked accounts). */
  Players: undefined;
  /**
   * Manual scoring entry. The caller (a session/solo flow, S12) supplies whose
   * game this is — `ownerUserId` is the recording account, `playerId` is the
   * bowler. `sessionId` is omitted/null for a solo game.
   */
  Score: {
    ownerUserId: string;
    playerId: string;
    sessionId?: string | null;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Generic placeholder screen body until feature slices supply real screens. */
function Placeholder({ title }: { readonly title: string }): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center">
      <Text className="text-lg font-semibold">{title}</Text>
    </View>
  );
}

function SessionsScreen(): React.JSX.Element {
  return <Placeholder title="Sessions" />;
}

function StatsScreen(): React.JSX.Element {
  return <Placeholder title="Stats" />;
}

function ArsenalScreen(): React.JSX.Element {
  return <Placeholder title="Arsenal" />;
}

/** Root navigator mounted under the provider tree. */
export function RootNavigation(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Sessions">
          <Stack.Screen name="Sessions" component={SessionsScreen} />
          <Stack.Screen name="Stats" component={StatsScreen} />
          <Stack.Screen name="Arsenal" component={ArsenalScreen} />
          <Stack.Screen name="Players" component={PlayersScreen} />
          <Stack.Screen name="Score" component={ScoreEntryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
