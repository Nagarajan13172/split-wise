import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, ErrorBanner, Field, H1, InfoBanner, Input, Screen, Sub } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';

const schema = z.object({ email: z.string().email() });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { handleSubmit, formState, setValue } = useForm<Values>({ resolver: zodResolver(schema) });
  const req = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
    onError: (err) => setError(err.message),
  });

  return (
    <Screen>
      <H1>Reset password</H1>
      <Sub>We'll email you a reset link.</Sub>
      <View className="mt-8 gap-4">
        {sent ? (
          <InfoBanner kind="success">
            If an account exists for that email, a reset link has been sent.
          </InfoBanner>
        ) : (
          <>
            <Field label="Email" error={formState.errors.email?.message}>
              <Input
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={(v) => setValue('email', v)}
              />
            </Field>
            <ErrorBanner error={error} />
            <Button
              onPress={handleSubmit((v) => {
                setError(null);
                req.mutate(v);
              })}
              loading={req.isPending}
              disabled={req.isPending}
            >
              Send reset link
            </Button>
          </>
        )}
        <Link href="/sign-in" className="text-xs text-slate-500">
          Back to sign in
        </Link>
      </View>
    </Screen>
  );
}
