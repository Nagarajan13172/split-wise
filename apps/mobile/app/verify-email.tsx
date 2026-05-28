import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, H1, InfoBanner, Screen } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';

export default function VerifyEmailScreen() {
  const { token: tokenParam } = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [error, setError] = useState<string | null>(token ? null : 'Missing verification token');
  const verify = trpc.auth.verifyEmail.useMutation();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !token) return;
    fired.current = true;
    verify.mutate(
      { token },
      {
        onSuccess: () => setStatus('ok'),
        onError: (err) => {
          setStatus('error');
          setError(err.message);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Screen>
      <H1>Verify email</H1>
      <View className="mt-8 gap-4">
        {status === 'pending' && <InfoBanner>Verifying…</InfoBanner>}
        {status === 'ok' && (
          <>
            <InfoBanner kind="success">Your email is verified.</InfoBanner>
            <Button onPress={() => router.replace('/')}>Continue</Button>
          </>
        )}
        {status === 'error' && (
          <>
            <InfoBanner>{error ?? 'Verification failed.'}</InfoBanner>
            <Button onPress={() => router.replace('/sign-in')}>Back to sign in</Button>
          </>
        )}
      </View>
    </Screen>
  );
}
