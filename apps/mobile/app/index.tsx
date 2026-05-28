import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatMoney } from '@split-wise/shared';
import { Button, ErrorBanner, H1, InfoBanner, Sub } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';
import { useAuth } from '../src/lib/auth';

export default function GroupsList() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const list = trpc.groups.list.useQuery();
  const activity = trpc.expenses.activity.useQuery({ limit: 15 });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await useAuth.getState().clear();
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerClassName="px-6 py-8">
        <View className="flex-row items-start justify-between">
          <View>
            <H1>Your groups</H1>
            <Sub>Signed in as {me.data?.email ?? '…'}</Sub>
          </View>
          <View className="flex-row gap-2">
            <Button variant="ghost" onPress={() => router.push('/settings')}>
              Settings
            </Button>
            <Button variant="ghost" onPress={() => logout.mutate()}>
              Sign out
            </Button>
          </View>
        </View>

        {me.data && !me.data.emailVerifiedAt ? (
          <View className="mt-4">
            <InfoBanner>
              Email not verified. Check Mailpit at http://localhost:8025 on the laptop.
            </InfoBanner>
          </View>
        ) : null}

        <View className="mt-6">
          <Button onPress={() => router.push('/groups/new')}>+ New group</Button>
        </View>

        <View className="mt-6 gap-3">
          {list.isLoading ? (
            <Text className="text-sm text-slate-500">Loading…</Text>
          ) : list.error ? (
            <ErrorBanner error={list.error.message} />
          ) : list.data && list.data.length === 0 ? (
            <InfoBanner>
              No groups yet. Tap <Text className="font-medium">+ New group</Text> to create one.
            </InfoBanner>
          ) : (
            list.data?.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => router.push(`/groups/${g.id}`)}
                className="rounded-xl border border-slate-200 bg-white p-5 active:bg-slate-100"
              >
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-base font-semibold text-slate-900">{g.name}</Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.defaultCurrency}
                    </Text>
                  </View>
                  <Text className="text-slate-400">→</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>

        {activity.data && activity.data.items.length > 0 ? (
          <View className="mt-8">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent activity
            </Text>
            <View className="mt-3 gap-2">
              {activity.data.items.map((it) => (
                <Pressable
                  key={`${it.kind}:${it.id}`}
                  onPress={() => router.push(`/groups/${it.group.id}`)}
                  className="rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-100"
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-slate-900">
                        {it.icon ? `${it.icon} ` : ''}
                        {it.title}
                      </Text>
                      <Text className="mt-0.5 text-xs text-slate-500">
                        {it.group.name} · {it.subtitle}
                      </Text>
                      <Text className="mt-0.5 text-xs text-slate-400">
                        {new Date(it.occurredAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text className="text-sm font-semibold text-slate-900">
                      {formatMoney(it.amount, it.currency)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
