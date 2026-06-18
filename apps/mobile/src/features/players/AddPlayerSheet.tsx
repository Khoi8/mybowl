/**
 * Add-person UI — the reuse-first contact picker (CLAUDE.md §6/§11).
 *
 * Thin: all logic (search ranking, guest creation) lives in the RN-free store.
 * The layout encodes the product rule visually: as the user types, MATCHING
 * EXISTING CONTACTS are listed prominently at the top ("tap to reuse"); the
 * "Create new guest" action is rendered last and styled as clearly secondary,
 * and only offered once there is a non-empty name. This pushes the user toward
 * reusing "Mike" rather than minting a second "Mike" and fragmenting stats.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getDb } from '../../db/client';
import type { Player } from '../../db/schema';
import { usePlayers } from './usePlayers';

interface AddPlayerSheetProps {
  /** Called with the chosen/created contact (existing or new guest). */
  readonly onPicked: (player: Player) => void;
}

export function AddPlayerSheet({ onPicked }: AddPlayerSheetProps): React.JSX.Element {
  const { search, createGuest } = usePlayers();
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const matches = search(query);
  const hasExactMatch =
    matches[0] !== undefined && matches[0].name.toLowerCase() === trimmed.toLowerCase();

  const onCreate = (): void => {
    onPicked(createGuest(getDb(), trimmed));
    setQuery('');
  };

  return (
    <View className="p-4">
      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Search a contact or type a new name"
        value={query}
        onChangeText={setQuery}
        autoFocus
      />

      {/* PRIMARY: reuse an existing contact. */}
      <View className="mt-3">
        {matches.length > 0 ? (
          <Text className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Existing contacts
          </Text>
        ) : null}
        {matches.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => onPicked(p)}
            className="border-b border-gray-100 py-3"
          >
            <Text className="text-base text-gray-900">{p.name}</Text>
          </Pressable>
        ))}
      </View>

      {/* SECONDARY/FALLBACK: only when there is a name and no exact reuse. */}
      {trimmed !== '' && !hasExactMatch ? (
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          className="mt-4 rounded-lg border border-dashed border-gray-300 px-3 py-2"
        >
          <Text className="text-sm text-gray-500">
            Create new guest &ldquo;{trimmed}&rdquo;
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
