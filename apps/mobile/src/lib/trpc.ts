import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AppRouter } from '@split-wise/api/src/trpc/app.router.js';

export const trpc = createTRPCReact<AppRouter>();

const configured = (Constants.expoConfig?.extra as { API_BASE_URL?: string } | undefined)
  ?.API_BASE_URL;

/**
 * In iOS simulator + web, localhost works; on Android emulator use 10.0.2.2;
 * on a physical device set EXPO_PUBLIC_API_BASE_URL to your LAN IP.
 */
function pickBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) return process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured) {
    if (Platform.OS === 'android' && configured.includes('localhost')) {
      return configured.replace('localhost', '10.0.2.2');
    }
    return configured;
  }
  return 'http://localhost:4000';
}

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${pickBaseUrl()}/trpc`,
        transformer: superjson,
      }),
    ],
  });
}
