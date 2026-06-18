/**
 * Add-a-ball form — minimal arsenal entry.
 *
 * Thin: name is required; brand/weight are optional conveniences. All persistence
 * (sync stamping, list refresh) lives in the RN-free store. NO business logic
 * here. The `ownerUserId` is supplied by the parent (derived from the self
 * player) — this form never mints identity.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getDb } from '../../db/client';
import { useArsenal } from './useArsenal';

interface BallFormProps {
  /** Recording account that owns the ball. */
  readonly ownerUserId: string;
}

export function BallForm({ ownerUserId }: BallFormProps): React.JSX.Element {
  const { create } = useArsenal();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [weight, setWeight] = useState('');

  const trimmedName = name.trim();
  const canAdd = trimmedName !== '';

  const onAdd = (): void => {
    if (!canAdd) return;
    const parsedWeight = weight.trim() === '' ? null : Number(weight);
    create(getDb(), {
      ownerUserId,
      name: trimmedName,
      brand: brand.trim() === '' ? null : brand.trim(),
      weight:
        parsedWeight !== null && Number.isFinite(parsedWeight) ? parsedWeight : null,
    });
    setName('');
    setBrand('');
    setWeight('');
  };

  return (
    <View className="gap-2 p-4">
      <TextInput
        className="rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Ball name (e.g. Phaze II)"
        value={name}
        onChangeText={setName}
      />
      <View className="flex-row gap-2">
        <TextInput
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
          placeholder="Brand"
          value={brand}
          onChangeText={setBrand}
        />
        <TextInput
          className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-base"
          placeholder="Weight"
          keyboardType="numeric"
          value={weight}
          onChangeText={setWeight}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={onAdd}
        className={
          canAdd ? 'rounded-lg bg-blue-600 px-4 py-2' : 'rounded-lg bg-gray-200 px-4 py-2'
        }
      >
        <Text
          className={
            canAdd
              ? 'text-center font-semibold text-white'
              : 'text-center font-semibold text-gray-400'
          }
        >
          Add ball
        </Text>
      </Pressable>
    </View>
  );
}
