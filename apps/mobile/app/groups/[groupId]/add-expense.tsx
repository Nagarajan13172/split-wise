import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CATEGORIES,
  CURRENCIES,
  formatMoney,
  type SplitType,
} from '@split-wise/shared';
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

type Mode = Extract<SplitType, 'EQUAL' | 'SHARES' | 'PERCENT' | 'EXACT'>;

function newClientId() {
  return `tmp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

const MODE_LABELS: Record<Mode, string> = {
  EQUAL: 'Equal',
  SHARES: 'Shares',
  PERCENT: 'Percent',
  EXACT: 'Exact',
};

export default function AddExpenseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = String(params.groupId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [paidById, setPaidById] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('EQUAL');

  // EQUAL: excluded members
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // SHARES / PERCENT / EXACT: per-member values keyed by userId
  const [values, setValues] = useState<Record<string, string>>({});

  const [categoryKey, setCategoryKey] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const members = group.data?.members ?? [];
  const effectivePaidById = paidById ?? me.data?.id ?? null;
  const effectiveCurrency = currency ?? group.data?.defaultCurrency ?? 'USD';

  const splitAmongUserIds = useMemo(() => {
    if (mode === 'EQUAL') {
      return members.filter((m) => !excluded.has(m.id)).map((m) => m.id);
    }
    return members.filter((m) => Number(values[m.id] ?? '') > 0).map((m) => m.id);
  }, [members, excluded, values, mode]);

  const numericAmount = Number(amount);
  const perPerson =
    mode === 'EQUAL' && Number.isFinite(numericAmount) && numericAmount > 0 && splitAmongUserIds.length > 0
      ? (numericAmount / splitAmongUserIds.length).toFixed(2)
      : null;

  const valuesSum = useMemo(() => {
    if (mode === 'EQUAL') return 0;
    return members.reduce((acc, m) => acc + (Number(values[m.id] ?? '') || 0), 0);
  }, [members, values, mode]);

  const create = trpc.expenses.create.useMutation({
    onMutate: async (input) => {
      await utils.expenses.list.cancel({ groupId });
      const prev = utils.expenses.list.getData({ groupId, limit: 30 });
      const payer = members.find((m) => m.id === input.paidById);
      const participantIds: string[] =
        input.splitType === 'EQUAL'
          ? input.splitAmongUserIds
          : input.splitType === 'SHARES'
            ? input.shareUnits.map((u) => u.userId)
            : input.splitType === 'PERCENT'
              ? input.percents.map((p) => p.userId)
              : input.splitType === 'EXACT'
                ? input.exactAmounts.map((a) => a.userId)
                : // ITEMIZED — flatten unique assignees across items
                  [
                    ...new Set(
                      input.items.flatMap((it) => it.assigneeIds),
                    ),
                  ];
      utils.expenses.list.setData({ groupId, limit: 30 }, (cur) => {
        const item = {
          id: newClientId(),
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          occurredAt: input.occurredAt,
          paidBy: { id: input.paidById, displayName: payer?.displayName ?? 'You' },
          category: null as null | { key: string; label: string; icon: string },
          shares: participantIds.map((userId) => ({
            userId,
            amount: (Number(input.amount) / participantIds.length).toFixed(2),
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

  function clientValidate(): string | null {
    if (!description.trim()) return 'Description is required.';
    if (!effectivePaidById) return 'Choose who paid.';
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 'Amount must be positive.';
    if (mode === 'EQUAL') {
      if (splitAmongUserIds.length === 0) return 'Pick at least one member.';
      return null;
    }
    const positiveMembers = members.filter((m) => Number(values[m.id] ?? '') > 0);
    if (positiveMembers.length === 0) return 'Enter a value for at least one member.';
    if (mode === 'PERCENT' && Math.abs(valuesSum - 100) > 0.001) {
      return `Percents must sum to 100 (currently ${valuesSum.toFixed(2)}).`;
    }
    if (mode === 'EXACT' && Math.abs(valuesSum - numericAmount) > 0.005) {
      return `Shares must sum to ${numericAmount.toFixed(2)} (currently ${valuesSum.toFixed(2)}).`;
    }
    return null;
  }

  const validationError = clientValidate();

  const submit = () => {
    setError(null);
    if (!effectivePaidById) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    const base = {
      groupId,
      paidById: effectivePaidById,
      description: description.trim(),
      amount: numericAmount.toFixed(2),
      currency: effectiveCurrency,
      occurredAt: new Date().toISOString(),
      categoryKey,
    };
    if (mode === 'EQUAL') {
      create.mutate({ ...base, splitType: 'EQUAL', splitAmongUserIds });
    } else if (mode === 'SHARES') {
      const shareUnits = members
        .filter((m) => Number(values[m.id] ?? '') > 0)
        .map((m) => ({ userId: m.id, units: values[m.id]! }));
      create.mutate({ ...base, splitType: 'SHARES', shareUnits });
    } else if (mode === 'PERCENT') {
      const percents = members
        .filter((m) => Number(values[m.id] ?? '') > 0)
        .map((m) => ({ userId: m.id, percent: values[m.id]! }));
      create.mutate({ ...base, splitType: 'PERCENT', percents });
    } else {
      const exactAmounts = members
        .filter((m) => Number(values[m.id] ?? '') > 0)
        .map((m) => ({ userId: m.id, amount: Number(values[m.id]).toFixed(2) }));
      create.mutate({ ...base, splitType: 'EXACT', exactAmounts });
    }
  };

  const renderPerMemberInputs = (suffix: string) => (
    <View className="gap-2">
      {members.map((m) => (
        <View key={m.id} className="flex-row items-center gap-2">
          <Text className="flex-1 text-sm text-slate-800">
            {m.displayName}
            {m.id === me.data?.id ? ' (you)' : ''}
          </Text>
          <View className="w-32">
            <Input
              keyboardType="decimal-pad"
              placeholder="0"
              value={values[m.id] ?? ''}
              onChangeText={(v) => setValues((cur) => ({ ...cur, [m.id]: v }))}
            />
          </View>
          <Text className="w-6 text-xs text-slate-500">{suffix}</Text>
        </View>
      ))}
    </View>
  );

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

        <View className="mt-4">
          <Button
            variant="ghost"
            onPress={() =>
              router.push({ pathname: '/groups/[groupId]/scan-receipt', params: { groupId } })
            }
          >
            📸 Scan a receipt instead
          </Button>
        </View>

        <View className="mt-6 gap-4">
          <Field label="What for?">
            <Input
              placeholder="e.g. Dinner at Luigi's"
              value={description}
              onChangeText={setDescription}
            />
          </Field>

          <Field label={`Amount (${effectiveCurrency})`}>
            <Input
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
            />
          </Field>

          <Field label="Currency">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {CURRENCIES.map((c) => {
                  const sel = effectiveCurrency === c.code;
                  return (
                    <Pressable
                      key={c.code}
                      onPress={() => setCurrency(c.code)}
                      className={`rounded-full border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                    >
                      <Text className={sel ? 'text-white' : 'text-slate-700'}>
                        {c.symbol} {c.code}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
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

          <Field label="Split method">
            <View className="flex-row gap-2">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => {
                const sel = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    className={`flex-1 rounded-md border px-3 py-2 ${sel ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={`text-center ${sel ? 'text-white' : 'text-slate-700'}`}>
                      {MODE_LABELS[m]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          {mode === 'EQUAL' ? (
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
                  ~ {formatMoney(perPerson, effectiveCurrency)} per person
                </Text>
              ) : null}
            </Field>
          ) : null}

          {mode === 'SHARES' ? (
            <Field label="Shares per member">
              {renderPerMemberInputs('×')}
              <Text className="mt-2 text-xs text-slate-500">
                Total units: {valuesSum.toFixed(2)} · members get amount proportional to their units
              </Text>
            </Field>
          ) : null}

          {mode === 'PERCENT' ? (
            <Field label="Percent per member">
              {renderPerMemberInputs('%')}
              <Text
                className={`mt-2 text-xs ${Math.abs(valuesSum - 100) > 0.001 ? 'text-rose-600' : 'text-emerald-700'}`}
              >
                Sum: {valuesSum.toFixed(2)}% {Math.abs(valuesSum - 100) > 0.001 ? '(must be 100)' : '✓'}
              </Text>
            </Field>
          ) : null}

          {mode === 'EXACT' ? (
            <Field label={`Exact amount per member (${effectiveCurrency})`}>
              {renderPerMemberInputs(effectiveCurrency)}
              <Text
                className={`mt-2 text-xs ${Math.abs(valuesSum - numericAmount) > 0.005 ? 'text-rose-600' : 'text-emerald-700'}`}
              >
                Sum: {valuesSum.toFixed(2)} of {numericAmount.toFixed(2)}
                {Math.abs(valuesSum - numericAmount) > 0.005 ? ' (must match total)' : ' ✓'}
              </Text>
            </Field>
          ) : null}

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

          <Button
            onPress={submit}
            disabled={!!validationError || create.isPending}
            loading={create.isPending}
          >
            Save expense
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
