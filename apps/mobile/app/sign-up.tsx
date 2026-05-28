import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zSignUp, type SignUpDTO } from '@split-wise/shared';
import { Button, ErrorBanner, Field, H1, Input, Screen, Sub } from '../src/components/ui';
import { trpc } from '../src/lib/trpc';
import { useAuth } from '../src/lib/auth';
import { popPendingInviteToken } from '../src/lib/pending-invite';

export default function SignUpScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { handleSubmit, formState, setValue } = useForm<SignUpDTO>({
    resolver: zodResolver(zSignUp),
    defaultValues: { homeCurrency: 'USD' },
  });
  const signup = trpc.auth.signup.useMutation({
    onSuccess: async (data) => {
      await useAuth.getState().setSession(data.user, data.accessToken, data.refreshToken);
      const pending = await popPendingInviteToken();
      if (pending) router.replace(`/invite/${encodeURIComponent(pending)}`);
    },
    onError: (err) => setError(err.message),
  });

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <H1>Create your account</H1>
        <Sub>It takes about ten seconds.</Sub>
        <View className="mt-8 gap-4">
          <Field label="Your name" error={formState.errors.displayName?.message}>
            <Input autoComplete="name" onChangeText={(v) => setValue('displayName', v)} />
          </Field>
          <Field label="Email" error={formState.errors.email?.message}>
            <Input
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={(v) => setValue('email', v)}
            />
          </Field>
          <Field label="Password" error={formState.errors.password?.message}>
            <Input
              secureTextEntry
              placeholder="At least 10 characters"
              onChangeText={(v) => setValue('password', v)}
            />
          </Field>
          <ErrorBanner error={error} />
          <Button
            onPress={handleSubmit((v) => {
              setError(null);
              signup.mutate(v);
            })}
            loading={signup.isPending}
            disabled={signup.isPending}
          >
            Create account
          </Button>
          <Link href="/sign-in" className="text-xs text-slate-500">
            Already have an account? Sign in
          </Link>
        </View>
      </ScrollView>
    </Screen>
  );
}
