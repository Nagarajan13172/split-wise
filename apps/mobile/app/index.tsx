import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { trpc } from '../src/lib/trpc';

export default function Home() {
  const ping = trpc.ping.useQuery();
  const health = trpc.health.useQuery();

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerClassName="p-6">
        <Text className="text-3xl font-bold text-slate-900">Splitwise</Text>
        <Text className="mt-1 text-slate-600">Phase 0 — foundation smoke test.</Text>

        <View className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            tRPC: ping
          </Text>
          <Text className="mt-2 font-mono text-xs">
            {ping.isLoading
              ? 'loading…'
              : ping.error
                ? `error: ${ping.error.message}`
                : JSON.stringify(ping.data, null, 2)}
          </Text>
        </View>

        <View className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            tRPC: health
          </Text>
          <Text className="mt-2 font-mono text-xs">
            {health.isLoading
              ? 'loading…'
              : health.error
                ? `error: ${health.error.message}`
                : JSON.stringify(health.data, null, 2)}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
