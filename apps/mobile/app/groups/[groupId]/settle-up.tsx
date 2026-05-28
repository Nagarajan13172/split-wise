import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatMoney } from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  InfoBanner,
  Input,
  Screen,
  Sub,
} from '../../../src/components/ui';
import { trpc } from '../../../src/lib/trpc';

export default function SettleUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = String(params.groupId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();
  const balances = trpc.expenses.forGroup.useQuery({ groupId });

  // Suggested debts (positive amounts) where the current user is the debtor.
  const suggestions = useMemo(() => {
    if (!me.data) return [];
    return (balances.data?.pairwise ?? []).filter((p) => p.fromUserId === me.data!.id);
  }, [balances.data, me.data]);

  const [fromUserId, setFromUserId] = useState<string | null>(null);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [error, setError] = useState<string | null>(null);

  const effectiveFrom = fromUserId ?? me.data?.id ?? null;
  const effectiveCurrency = currency ?? group.data?.defaultCurrency ?? 'USD';
  const numericAmount = Number(amount);

  const record = trpc.expenses.recordSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.listSettlements.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
      router.back();
    },
    onError: (err) => setError(err.message),
  });

  const useSuggestion = (p: { fromUserId: string; toUserId: string; amount: string; currency: string }) => {
    setFromUserId(p.fromUserId);
    setToUserId(p.toUserId);
    setAmount(p.amount);
    setCurrency(p.currency);
  };

  const submit = () => {
    setError(null);
    if (!effectiveFrom || !toUserId) {
      setError('Choose who paid and who was paid.');
      return;
    }
    if (effectiveFrom === toUserId) {
      setError('Payer and payee must differ.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    record.mutate({
      groupId,
      fromUserId: effectiveFrom,
      toUserId,
      amount: numericAmount.toFixed(2),
      currency: effectiveCurrency,
      occurredAt: new Date().toISOString(),
      method: method.trim() || undefined,
    });
  };

  const members = group.data?.members ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>
        <View className="mt-2">
          <H1>Settle up</H1>
          <Sub>{group.data?.name ?? '…'}</Sub>
        </View>

        {suggestions.length > 0 ? (
          <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quick settle
            </Text>
            <View className="mt-3 gap-2">
              {suggestions.map((p, i) => {
                const to = memberById.get(p.toUserId);
                return (
                  <Pressable
                    key={i}
                    onPress={() => useSuggestion(p)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-3 active:bg-slate-100"
                  >
                    <Text className="text-sm text-slate-800">
                      Pay <Text className="font-medium">{to?.displayName ?? '?'}</Text>{' '}
                      {formatMoney(p.amount, p.currency)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <View className="mt-6">
            <InfoBanner>No outstanding debts that you owe. You can still log a manual settlement below.</InfoBanner>
          </View>
        )}

        <View className="mt-6 gap-4">
          <Field label="From (who paid)">
            <View className="gap-1">
              {members.map((m) => {
                const selected = effectiveFrom === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setFromUserId(m.id)}
                    className={`rounded-md border px-3 py-2 ${selected ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={selected ? 'text-white' : 'text-slate-800'}>
                      {m.displayName}
                      {m.id === me.data?.id ? ' (you)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="To (who was paid)">
            <View className="gap-1">
              {members
                .filter((m) => m.id !== effectiveFrom)
                .map((m) => {
                  const selected = toUserId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setToUserId(m.id)}
                      className={`rounded-md border px-3 py-2 ${selected ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={selected ? 'text-white' : 'text-slate-800'}>
                        {m.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          </Field>

          <Field label={`Amount (${effectiveCurrency})`}>
            <Input
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
            />
          </Field>

          <Field label="Method (optional)">
            <Input
              placeholder="e.g. Venmo, cash"
              value={method}
              onChangeText={setMethod}
            />
          </Field>

          <ErrorBanner error={error} />

          <Button onPress={submit} disabled={record.isPending} loading={record.isPending}>
            Record settlement
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
