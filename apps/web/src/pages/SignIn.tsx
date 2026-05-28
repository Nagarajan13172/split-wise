import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zSignIn, type SignInDTO } from '@split-wise/shared';
import { AuthCard, Button, Field, FormError, Input } from '../components/ui.js';
import { GoogleButton } from '../components/GoogleButton.js';
import { trpc } from '../lib/trpc.js';
import { useAuth } from '../lib/auth.js';
import type { NavigateFn } from '../router.js';
import { popPendingInviteToken } from './InviteAccept.js';

export function SignIn({ navigate }: { navigate: NavigateFn }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<SignInDTO>({
    resolver: zodResolver(zSignIn),
  });
  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      useAuth.getState().setSession(data.user, data.accessToken);
      const pending = popPendingInviteToken();
      navigate(pending ? `/invite/${encodeURIComponent(pending)}` : '/');
    },
    onError: (err) => setError(err.message),
  });

  return (
    <AuthCard title="Sign in" subtitle="Welcome back.">
      <form
        onSubmit={handleSubmit((v) => {
          setError(null);
          login.mutate(v);
        })}
        className="space-y-4"
      >
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <FormError error={error} />
        <Button type="submit" disabled={login.isPending} className="w-full">
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <GoogleButton navigate={navigate} />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <button onClick={() => navigate('/forgot-password')} className="hover:underline">
          Forgot password?
        </button>
        <button onClick={() => navigate('/sign-up')} className="hover:underline">
          Create account
        </button>
      </div>
    </AuthCard>
  );
}
