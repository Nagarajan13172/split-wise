import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zGroupCreate, type GroupCreateDTO, CURRENCIES } from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  Input,
  Screen,
  Sub,
} from '../../src/components/ui';
import { trpc } from '../../src/lib/trpc';

export default function NewGroupScreen() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const { handleSubmit, formState, setValue, watch } = useForm<GroupCreateDTO>({
    resolver: zodResolver(zGroupCreate),
    defaultValues: {
      name: '',
      defaultCurrency: me.data?.homeCurrency ?? 'USD',
      simplifyDebts: true,
    },
  });

  const create = trpc.groups.create.useMutation({
    onSuccess: async (g) => {
      await utils.groups.list.invalidate();
      router.replace(`/groups/${g.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const currency = watch('defaultCurrency') ?? 'USD';
  const simplify = watch('simplifyDebts') ?? true;

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <View className="mt-2">
          <H1>New group</H1>
          <Sub>Add a name and pick a default currency.</Sub>
        </View>
        <View className="mt-8 gap-4">
          <Field label="Name" error={formState.errors.name?.message}>
            <Input
              placeholder="Apartment, Bali trip…"
              onChangeText={(v) => setValue('name', v)}
            />
          </Field>
          <Field label="Default currency" error={formState.errors.defaultCurrency?.message}>
            <View className="flex-row flex-wrap gap-2">
              {CURRENCIES.slice(0, 10).map((c) => {
                const selected = currency === c.code;
                return (
                  <Button
                    key={c.code}
                    variant={selected ? 'primary' : 'ghost'}
                    onPress={() => setValue('defaultCurrency', c.code)}
                  >
                    {c.code}
                  </Button>
                );
              })}
            </View>
          </Field>
          <Button
            variant={simplify ? 'primary' : 'ghost'}
            onPress={() => setValue('simplifyDebts', !simplify)}
          >
            {simplify ? '✓ Simplify debts' : 'Simplify debts'}
          </Button>
          <ErrorBanner error={error} />
          <Button
            onPress={handleSubmit((v) => {
              setError(null);
              create.mutate(v);
            })}
            loading={create.isPending}
            disabled={create.isPending}
          >
            Create group
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
