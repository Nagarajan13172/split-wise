import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, ErrorBanner, Field, H1, InfoBanner, Input, Screen } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';

const schema = z.object({ newPassword: z.string().min(10).max(128) });
type Values = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const { token: tokenParam } = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : 'Missing reset token');
  const { handleSubmit, formState, setValue } = useForm<Values>({ resolver: zodResolver(schema) });
  const confirm = trpc.auth.confirmPasswordReset.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => setError(err.message),
  });

  return (
    <Screen>
      <H1>Choose a new password</H1>
      <View className="mt-8 gap-4">
        {done ? (
          <>
            <InfoBanner kind="success">Password updated. You can sign in now.</InfoBanner>
            <Button onPress={() => router.replace('/sign-in')}>Go to sign in</Button>
          </>
        ) : (
          <>
            <Field label="New password" error={formState.errors.newPassword?.message}>
              <Input
                secureTextEntry
                placeholder="At least 10 characters"
                onChangeText={(v) => setValue('newPassword', v)}
              />
            </Field>
            <ErrorBanner error={error} />
            <Button
              onPress={handleSubmit((v) => {
                if (!token) return;
                setError(null);
                confirm.mutate({ token, newPassword: v.newPassword });
              })}
              loading={confirm.isPending}
              disabled={confirm.isPending || !token}
            >
              Update password
            </Button>
          </>
        )}
      </View>
    </Screen>
  );
}
