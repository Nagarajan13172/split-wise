import { useState } from 'react';
import { Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Constants from 'expo-constants';
import { zSignIn, type SignInDTO } from '@split-wise/shared';
import { Button, ErrorBanner, Field, H1, InfoBanner, Input, Screen, Sub } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';
import { useAuth } from '../src/lib/auth';
import { popPendingInviteToken } from '../src/lib/pending-invite';

// Hardcoded demo credentials — populated into the form so you can just tap Sign in
// while we get a real account-creation UX in place.
const DEMO_EMAIL = 'demo@splitwise.local';
const DEMO_PASSWORD = 'demo-account-pass-2026';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra as { API_BASE_URL?: string } | undefined)?.API_BASE_URL ??
  'http://localhost:4000';

export default function SignInScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState, setValue, watch } = useForm<SignInDTO>({
    resolver: zodResolver(zSignIn),
    defaultValues: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  const login = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      await useAuth.getState().setSession(data.user, data.accessToken, data.refreshToken);
      const pending = await popPendingInviteToken();
      if (pending) router.replace(`/invite/${encodeURIComponent(pending)}`);
    },
    onError: (err) => {
      // tRPC client surfaces native fetch failures as "Failed to fetch" / "Network request failed".
      const isNetwork =
        /network request failed|failed to fetch|network error|timeout/i.test(err.message);
      if (isNetwork) {
        setError(
          `Can't reach the API at ${API_BASE_URL}.\n\n` +
            "Likely fixes:\n" +
            "• iOS: Settings → Privacy & Security → Local Network → enable Expo Go\n" +
            "• macOS firewall: System Settings → Network → Firewall → Off (or allow node)\n" +
            "• Phone + laptop on the same WiFi (no guest network)",
        );
      } else {
        setError(err.message);
      }
    },
  });

  // Keep RHF wiring happy
  watch('email');
  watch('password');

  return (
    <Screen>
      <H1>Sign in</H1>
      <Sub>Demo credentials are pre-filled. Tap Sign in.</Sub>
      <View className="mt-8 gap-4">
        <InfoBanner>
          Demo account: <Text className="font-mono">{DEMO_EMAIL}</Text>
        </InfoBanner>
        <Field label="Email" error={formState.errors.email?.message}>
          <Input
            defaultValue={DEMO_EMAIL}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={(v) => setValue('email', v)}
          />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <Input
            defaultValue={DEMO_PASSWORD}
            secureTextEntry
            autoComplete="password"
            onChangeText={(v) => setValue('password', v)}
          />
        </Field>
        <ErrorBanner error={error} />
        <Button
          onPress={handleSubmit((v) => {
            setError(null);
            login.mutate(v);
          })}
          loading={login.isPending}
          disabled={login.isPending}
        >
          Sign in
        </Button>
        <View className="flex-row items-center justify-between">
          <Link href="/forgot-password" className="text-xs text-slate-500">
            Forgot password?
          </Link>
          <Link href="/sign-up" className="text-xs text-slate-500">
            Create account
          </Link>
        </View>
      </View>
      {/* control is referenced to keep react-hook-form's type inference happy */}
      <View style={{ display: 'none' }}>
        <Text>{control ? '' : ''}</Text>
      </View>
    </Screen>
  );
}
