import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AppRouter } from '@split-wise/api/src/trpc/app.router.js';
import { getAccessToken, useAuth } from './auth';
import { getStoredRefreshToken, setStoredRefreshToken } from './secure-store';

export const trpc = createTRPCReact<AppRouter>();

const configured = (Constants.expoConfig?.extra as { API_BASE_URL?: string } | undefined)
  ?.API_BASE_URL;

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

const baseUrl = pickBaseUrl();

let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const stored = await getStoredRefreshToken();
      if (!stored) {
        await useAuth.getState().clear();
        return false;
      }
      const res = await fetch(`${baseUrl}/trpc/auth.refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: { refreshToken: stored } }),
      });
      if (!res.ok) {
        await useAuth.getState().clear();
        return false;
      }
      const body = await res.json();
      const data = body?.result?.data?.json;
      if (!data?.accessToken || !data?.refreshToken) {
        await useAuth.getState().clear();
        return false;
      }
      await setStoredRefreshToken(data.refreshToken);
      useAuth.getState().setSessionWithoutPersist(data.user, data.accessToken);
      return true;
    } catch {
      await useAuth.getState().clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
        transformer: superjson,
        async headers() {
          const token = getAccessToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        async fetch(url, opts) {
          const doFetch = (extra?: Record<string, string>) => {
            const headers: Record<string, string> = {};
            const base = opts?.headers;
            if (base && typeof base === 'object' && !Array.isArray(base)) {
              for (const [k, v] of Object.entries(base as Record<string, string>)) {
                headers[k] = String(v);
              }
            }
            if (extra) Object.assign(headers, extra);
            return fetch(url, { ...opts, headers });
          };
          let res = await doFetch();
          if (res.status === 401) {
            const refreshed = await attemptRefresh();
            if (refreshed) {
              const token = getAccessToken();
              res = await doFetch(token ? { authorization: `Bearer ${token}` } : undefined);
            }
          }
          return res;
        },
      }),
    ],
  });
}

/** Best-effort silent refresh on app start. */
export async function bootstrapSession(): Promise<void> {
  await attemptRefresh();
  useAuth.getState().setReady();
}
