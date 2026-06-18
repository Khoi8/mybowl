/**
 * App-wide provider tree.
 *
 * Responsibilities, in order:
 *  1. Ensure `crypto.getRandomValues` exists. The RNG polyfill is imported at
 *     the native entry (`index.ts`) before anything generates an id; we keep a
 *     defensive import here too so this tree is safe to mount in isolation.
 *  2. Run on-device SQLite migrations at launch via Drizzle's Expo migrator,
 *     against the generated `drizzle` bundle. SQLite is the source of truth, so
 *     the schema must be present before any screen reads/writes.
 *  3. Provide the TanStack Query client (offline-first defaults).
 *
 * The migration gate renders a lightweight status view until migrations finish;
 * children only mount once the local DB schema is ready. This mirrors the
 * `client.ts` contract: app-launch migrations run via
 * `drizzle-orm/expo-sqlite/migrator` against the generated `drizzle` folder.
 */
import 'react-native-get-random-values';

import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import { getDb } from '../db/client';
import migrations from '../../drizzle/migrations';
import { createQueryClient } from './queryClient';

interface ProvidersProps {
  readonly children: ReactNode;
}

/** Blocks children until the local SQLite schema is migrated to current. */
function MigrationGate({ children }: ProvidersProps): React.JSX.Element {
  const { success, error } = useMigrations(getDb(), migrations);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-center text-red-600">
          Could not prepare local database.{'\n'}
          {error.message}
        </Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Mounts the provider tree. The QueryClient is created once per mount (stable
 * across re-renders via `useMemo`) so cache survives navigation.
 */
export function Providers({ children }: ProvidersProps): React.JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MigrationGate>{children}</MigrationGate>
    </QueryClientProvider>
  );
}
