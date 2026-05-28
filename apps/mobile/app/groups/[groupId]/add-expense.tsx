import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CATEGORIES, formatMoney } from '@split-wise/shared';
import {
  Button,
  ErrorBanner,
  Field,
  H1,
  Input,
  Screen,
  Sub,
} from '../../../src/components/ui';
import { trpc } from '../../../src/lib/trpc';

function newClientId() {
  return `tmp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export default function AddExpenseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = String(params.groupId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidById, setPaidById] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [categoryKey, setCategoryKey] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.expenses.create.useMutation({
    onMutate: async (input) => {
      await utils.expenses.list.cancel({ groupId });
      const prev = utils.expenses.list.getData({ groupId, limit: 30 });
      const optimisticId = newClientId();
      const me = group.data?.members.find((m) => m.id === input.paidById);
      utils.expenses.list.setData({ groupId, limit: 30 }, (cur) => {
        const item = {
          id: optimisticId,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          occurredAt: input.occurredAt,
          paidBy: { id: input.paidById, displayName: me?.displayName ?? 'You' },
          category: null as null | { key: string; label: string; icon: string },
          shares: input.splitAmongUserIds.map((userId) => ({
            userId,
            amount: (Number(input.amount) / input.splitAmongUserIds.length).toFixed(2),
          })),
        };
        return cur
          ? { ...cur, items: [item, ...cur.items] }
          : { items: [item], nextCursor: undefined };
      });
      return { prev };
    },
    onError: (err, _input, ctx) => {
      setError(err.message);
      if (ctx?.prev) utils.expenses.list.setData({ groupId, limit: 30 }, ctx.prev);
    },
    onSettled: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onSuccess: () => {
      router.back();
    },
  });

  const members = group.data?.members ?? [];
  const effectivePaidById = paidById ?? me.data?.id ?? null;
  const splitAmongUserIds = useMemo(
    () => members.filter((m) => !excluded.has(m.id)).map((m) => m.id),
    [members, excluded],
  );

  const numericAmount = Number(amount);
  const perPerson =
    Number.isFinite(numericAmount) && numericAmount > 0 && splitAmongUserIds.length > 0
      ? (numericAmount / splitAmongUserIds.length).toFixed(2)
      : null;

  const canSubmit =
    !!description.trim() &&
    !!effectivePaidById &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    splitAmongUserIds.length > 0;

  const submit = () => {
    setError(null);
    if (!effectivePaidById) return;
    create.mutate({
      groupId,
      paidById: effectivePaidById,
      description: description.trim(),
      amount: numericAmount.toFixed(2),
      currency: group.data?.defaultCurrency ?? 'USD',
      occurredAt: new Date().toISOString(),
      splitType: 'EQUAL',
      splitAmongUserIds,
      categoryKey,
    });
  };

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>

        <View className="mt-2">
          <H1>Add expense</H1>
          <Sub>{group.data?.name ?? '…'}</Sub>
        </View>

        <View className="mt-6 gap-4">
          <Field label="What for?">
            <Input
              placeholder="e.g. Dinner at Luigi's"
              value={description}
              onChangeText={setDescription}
            />
          </Field>

          <Field label={`Amount (${group.data?.defaultCurrency ?? 'USD'})`}>
            <Input
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
            />
          </Field>

          <Field label="Paid by">
            <View className="gap-1">
              {members.map((m) => {
                const selected = effectivePaidById === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setPaidById(m.id)}
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

          <Field label="Split equally among">
            <View className="gap-1">
              {members.map((m) => {
                const included = !excluded.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      const next = new Set(excluded);
                      if (included) next.add(m.id);
                      else next.delete(m.id);
                      setExcluded(next);
                    }}
                    className={`flex-row items-center justify-between rounded-md border px-3 py-2 ${included ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={included ? 'text-emerald-900' : 'text-slate-500'}>
                      {m.displayName}
                      {m.id === me.data?.id ? ' (you)' : ''}
                    </Text>
                    <Text className={included ? 'text-emerald-700' : 'text-slate-400'}>
                      {included ? '✓ included' : 'excluded'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {perPerson ? (
              <Text className="mt-2 text-xs text-slate-500">
                ~ {formatMoney(perPerson, group.data?.defaultCurrency ?? 'USD')} per person
              </Text>
            ) : null}
          </Field>

          <Field label="Category (optional)">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {CATEGORIES.map((c) => {
                  const selected = categoryKey === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setCategoryKey(selected ? undefined : c.key)}
                      className={`rounded-full border px-3 py-2 ${selected ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={selected ? 'text-white' : 'text-slate-700'}>
                        {c.icon} {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Field>

          <ErrorBanner error={error} />

          <Button onPress={submit} disabled={!canSubmit || create.isPending} loading={create.isPending}>
            Save expense
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
