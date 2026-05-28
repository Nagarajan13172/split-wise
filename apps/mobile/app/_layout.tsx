import '../global.css';
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { trpc, makeTrpcClient, bootstrapSession } from '../src/lib/trpc';
import { useAuth } from '../src/lib/auth';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const first = segments[0] ?? '';
    const isAuthRoute = ['sign-in', 'sign-up', 'forgot-password'].includes(first);
    // Public token-bearing routes: rendered with or without auth so deep links work.
    const isPublicRoute = ['verify-email', 'reset-password', 'invite'].includes(first);
    if (!user && !isAuthRoute && !isPublicRoute) {
      router.replace('/sign-in');
    } else if (user && isAuthRoute) {
      router.replace('/');
    }
  }, [user, ready, segments, router]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => makeTrpcClient());

  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
