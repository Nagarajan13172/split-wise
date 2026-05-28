import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
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

export default function GroupDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = String(params.groupId);

  const utils = trpc.useUtils();
  const group = trpc.groups.get.useQuery({ groupId });
  const me = trpc.auth.me.useQuery();
  const expenses = trpc.expenses.list.useQuery({ groupId, limit: 30 });
  const balances = trpc.expenses.forGroup.useQuery({ groupId });
  const settlements = trpc.expenses.listSettlements.useQuery({ groupId });
  const invites = trpc.groups.listInvites.useQuery(
    { groupId },
    { enabled: !!group.data && (group.data.myRole === 'OWNER' || group.data.myRole === 'ADMIN') },
  );

  const [inviteEmail, setInviteEmail] = useState('');
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInvites, setShowInvites] = useState(false);
  const [simplify, setSimplify] = useState(false);

  // Seed Simplify toggle from the group's configured default once it loads.
  useEffect(() => {
    if (group.data?.simplifyDebts !== undefined) setSimplify(group.data.simplifyDebts);
  }, [group.data?.simplifyDebts]);

  const createInvite = trpc.groups.createInvite.useMutation({
    onSuccess: async (data) => {
      setError(null);
      setLatestUrl(data.url);
      setInviteEmail('');
      await utils.groups.listInvites.invalidate({ groupId });
    },
    onError: (err) => setError(err.message),
  });
  const revoke = trpc.groups.revokeInvite.useMutation({
    onSuccess: () => utils.groups.listInvites.invalidate({ groupId }),
  });
  const removeMember = trpc.groups.removeMember.useMutation({
    onSuccess: () => utils.groups.get.invalidate({ groupId }),
  });
  const leave = trpc.groups.leave.useMutation({
    onSuccess: () => {
      utils.groups.list.invalidate();
      router.replace('/');
    },
    onError: (err) => setError(err.message),
  });
  const del = trpc.groups.delete.useMutation({
    onSuccess: () => {
      utils.groups.list.invalidate();
      router.replace('/');
    },
  });
  const deleteExpense = trpc.expenses.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.list.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onError: (err) => setError(err.message),
  });
  const voidSettlement = trpc.expenses.voidSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.expenses.listSettlements.invalidate({ groupId }),
        utils.expenses.forGroup.invalidate({ groupId }),
        utils.expenses.activity.invalidate(),
      ]);
    },
    onError: (err) => setError(err.message),
  });

  const shareUrl = async (url: string) => {
    try {
      await Share.share({ message: url });
    } catch {
      /* user cancelled */
    }
  };

  if (group.isLoading) {
    return (
      <Screen>
        <Text className="text-sm text-slate-500">Loading…</Text>
      </Screen>
    );
  }
  if (group.error) {
    return (
      <Screen>
        <Button variant="ghost" onPress={() => router.back()}>
          ← Back
        </Button>
        <View className="mt-4">
          <ErrorBanner error={group.error.message} />
        </View>
      </Screen>
    );
  }
  if (!group.data) return null;

  const isAdmin = group.data.myRole === 'OWNER' || group.data.myRole === 'ADMIN';
  const isOwner = group.data.myRole === 'OWNER';
  const memberById = new Map(group.data.members.map((m) => [m.id, m]));
  const myUserId = me.data?.id;
  const myNet = balances.data?.members.find((m) => m.userId === myUserId)?.net ?? [];

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← All groups
        </Button>
        <View className="mt-2">
          <H1>{group.data.name}</H1>
          <Sub>
            {group.data.defaultCurrency} · you are{' '}
            <Text className="font-medium">{group.data.myRole.toLowerCase()}</Text>
          </Sub>
        </View>

        {/* Your balance summary */}
        <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your balance in this group
          </Text>
          {balances.isLoading ? (
            <Text className="mt-3 text-sm text-slate-500">Calculating…</Text>
          ) : myNet.length === 0 ? (
            <Text className="mt-3 text-sm text-slate-700">You're all settled up.</Text>
          ) : (
            <View className="mt-3 gap-1">
              {myNet.map((b) => {
                const positive = !b.amount.startsWith('-');
                return (
                  <Text
                    key={b.currency}
                    className={`text-base font-semibold ${positive ? 'text-emerald-700' : 'text-rose-700'}`}
                  >
                    {positive ? 'You are owed ' : 'You owe '}
                    {formatMoney(positive ? b.amount : b.amount.slice(1), b.currency)}
                  </Text>
                );
              })}
            </View>
          )}
          <View className="mt-4 flex-row gap-2">
            <View className="flex-1">
              <Button onPress={() => router.push(`/groups/${groupId}/add-expense`)}>
                + Add expense
              </Button>
            </View>
            <View className="flex-1">
              <Button
                variant="ghost"
                onPress={() => router.push(`/groups/${groupId}/settle-up`)}
              >
                Settle up
              </Button>
            </View>
          </View>
        </View>

        {/* Who owes whom (toggleable: pairwise vs simplified) */}
        {balances.data && (balances.data.pairwise.length > 0 || balances.data.simplified.length > 0) ? (
          <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Who owes whom
              </Text>
              <Pressable
                onPress={() => setSimplify((v) => !v)}
                className={`rounded-full border px-3 py-1 ${simplify ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white'}`}
              >
                <Text className={`text-xs ${simplify ? 'text-white' : 'text-slate-700'}`}>
                  {simplify ? 'Simplified ✓' : 'Simplify debts'}
                </Text>
              </Pressable>
            </View>
            <View className="mt-3 gap-1">
              {(simplify ? balances.data.simplified : balances.data.pairwise).map((p, i) => {
                const debtor = memberById.get(p.fromUserId)?.displayName ?? 'Someone';
                const creditor = memberById.get(p.toUserId)?.displayName ?? 'Someone';
                return (
                  <Text key={i} className="text-sm text-slate-700">
                    <Text className="font-medium">{debtor}</Text> owes{' '}
                    <Text className="font-medium">{creditor}</Text>{' '}
                    {formatMoney(p.amount, p.currency)}
                  </Text>
                );
              })}
            </View>
            <Text className="mt-2 text-xs text-slate-400">
              {simplify
                ? 'Fewest transfers (per-currency). FX is not applied.'
                : 'Raw pairwise debts.'}
            </Text>
          </View>
        ) : null}

        {/* Expense feed */}
        <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Expenses
          </Text>
          {expenses.isLoading ? (
            <Text className="mt-3 text-sm text-slate-500">Loading…</Text>
          ) : expenses.data?.items.length === 0 ? (
            <Text className="mt-3 text-sm text-slate-500">
              No expenses yet. Tap "Add expense" to get started.
            </Text>
          ) : (
            <View className="mt-3 divide-y divide-slate-100">
              {expenses.data?.items.map((e) => {
                const myShare = e.shares.find((s) => s.userId === myUserId);
                const youPaid = e.paidBy.id === myUserId;
                const blurb = youPaid
                  ? `you paid · ${formatMoney(e.amount, e.currency)}`
                  : myShare
                    ? `${e.paidBy.displayName} paid · your share ${formatMoney(myShare.amount, e.currency)}`
                    : `${e.paidBy.displayName} paid`;
                return (
                  <View key={e.id} className="py-3">
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-slate-900">
                          {e.category?.icon ? `${e.category.icon} ` : ''}
                          {e.description}
                        </Text>
                        <Text className="mt-0.5 text-xs text-slate-500">{blurb}</Text>
                        <Text className="mt-0.5 text-xs text-slate-400">
                          {new Date(e.occurredAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-sm font-semibold text-slate-900">
                          {formatMoney(e.amount, e.currency)}
                        </Text>
                        <View className="mt-1 flex-row gap-3">
                          <Pressable
                            onPress={() =>
                              router.push(`/groups/${groupId}/expense/${e.id}`)
                            }
                          >
                            <Text className="text-xs text-slate-600">Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              Alert.alert('Delete expense', `Delete "${e.description}"?`, [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: () => deleteExpense.mutate({ expenseId: e.id }),
                                },
                              ])
                            }
                          >
                            <Text className="text-xs text-rose-600">Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Settlements history */}
        {settlements.data && settlements.data.length > 0 ? (
          <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Settlements
            </Text>
            <View className="mt-3 divide-y divide-slate-100">
              {settlements.data.map((s) => (
                <View key={s.id} className="flex-row items-start justify-between py-2">
                  <View className="flex-1">
                    <Text className="text-sm text-slate-900">
                      {s.fromUser.displayName} → {s.toUser.displayName}
                    </Text>
                    <Text className="text-xs text-slate-500">
                      {new Date(s.occurredAt).toLocaleDateString()}
                      {s.method ? ` · ${s.method}` : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold text-slate-900">
                      {formatMoney(s.amount, s.currency)}
                    </Text>
                    <Pressable
                      onPress={() =>
                        Alert.alert('Void settlement', 'Mark this settlement as voided?', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Void',
                            style: 'destructive',
                            onPress: () => voidSettlement.mutate({ settlementId: s.id }),
                          },
                        ])
                      }
                    >
                      <Text className="mt-1 text-xs text-rose-600">Void</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Members */}
        <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Members ({group.data.members.length})
          </Text>
          <View className="mt-3 gap-2">
            {group.data.members.map((m) => (
              <View key={m.id} className="flex-row items-center justify-between py-1">
                <View>
                  <Text className="text-sm font-medium text-slate-900">{m.displayName}</Text>
                  <Text className="text-xs text-slate-500">
                    {m.email} · {m.role.toLowerCase()}
                  </Text>
                </View>
                {isAdmin && m.id !== me.data?.id && m.role !== 'OWNER' ? (
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Remove member',
                        `Remove ${m.displayName} from this group?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => removeMember.mutate({ groupId, userId: m.id }),
                          },
                        ],
                      )
                    }
                  >
                    <Text className="text-xs text-red-600">Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        {/* Invites (collapsed) */}
        {isAdmin ? (
          <View className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <Pressable onPress={() => setShowInvites((v) => !v)}>
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Invite people {showInvites ? '▾' : '▸'}
              </Text>
            </Pressable>
            {showInvites ? (
              <View className="mt-4 gap-3">
                <Button
                  onPress={() => createInvite.mutate({ groupId, expiresInHours: 24 * 7 })}
                  loading={createInvite.isPending}
                  disabled={createInvite.isPending}
                >
                  Generate share link
                </Button>
                <Field label="Or invite by email">
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Input
                        keyboardType="email-address"
                        autoCapitalize="none"
                        placeholder="friend@example.com"
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                      />
                    </View>
                    <Button
                      onPress={() =>
                        createInvite.mutate({
                          groupId,
                          email: inviteEmail,
                          expiresInHours: 24 * 7,
                        })
                      }
                      disabled={!inviteEmail || createInvite.isPending}
                    >
                      Send
                    </Button>
                  </View>
                </Field>
                {latestUrl ? (
                  <View className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                    <Text className="text-xs text-emerald-800">Share this link (expires in 7 days):</Text>
                    <Text className="mt-2 font-mono text-xs text-emerald-900" numberOfLines={2}>
                      {latestUrl}
                    </Text>
                    <View className="mt-3">
                      <Button onPress={() => shareUrl(latestUrl)}>Share</Button>
                    </View>
                  </View>
                ) : null}
                {invites.data && invites.data.length > 0 ? (
                  <View className="mt-2">
                    <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Active invites
                    </Text>
                    <View className="mt-2 gap-1">
                      {invites.data
                        .filter((i) => !i.expired && !i.acceptedAt)
                        .map((i) => (
                          <View
                            key={i.id}
                            className="flex-row items-center justify-between py-1"
                          >
                            <Text className="text-xs text-slate-600">
                              {i.email ?? 'Link invite'} · exp{' '}
                              {new Date(i.expiresAt).toLocaleDateString()}
                            </Text>
                            <Pressable onPress={() => revoke.mutate({ inviteId: i.id })}>
                              <Text className="text-xs text-red-600">Revoke</Text>
                            </Pressable>
                          </View>
                        ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <ErrorBanner error={error} />

        <View className="mt-6 gap-2">
          {!isOwner ? (
            <Button
              variant="ghost"
              onPress={() =>
                Alert.alert('Leave group', "You won't see this group anymore.", [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: () => leave.mutate({ groupId }),
                  },
                ])
              }
            >
              Leave group
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              variant="ghost"
              onPress={() =>
                Alert.alert(
                  'Delete group',
                  'The group disappears for everyone. Expenses are preserved.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => del.mutate({ groupId }),
                    },
                  ],
                )
              }
            >
              Delete group
            </Button>
          ) : null}
        </View>

        {!expenses.data?.items.length && !balances.data?.pairwise.length ? (
          <View className="mt-6">
            <InfoBanner>
              Add your first expense, then balances and settle-up will appear here.
            </InfoBanner>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
