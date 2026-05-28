import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zSignUp, type SignUpDTO, CURRENCIES } from '@split-wise/shared';
import { AuthCard, Button, Field, FormError, Input } from '../components/ui.js';
import { GoogleButton } from '../components/GoogleButton.js';
import { trpc } from '../lib/trpc.js';
import { useAuth } from '../lib/auth.js';
import type { NavigateFn } from '../router.js';
import { popPendingInviteToken } from './InviteAccept.js';

export function SignUp({ navigate }: { navigate: NavigateFn }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<SignUpDTO>({
    resolver: zodResolver(zSignUp),
    defaultValues: { homeCurrency: 'USD' },
  });
  const signup = trpc.auth.signup.useMutation({
    onSuccess: (data) => {
      useAuth.getState().setSession(data.user, data.accessToken);
      const pending = popPendingInviteToken();
      navigate(pending ? `/invite/${encodeURIComponent(pending)}` : '/');
    },
    onError: (err) => setError(err.message),
  });

  return (
    <AuthCard title="Create your account" subtitle="It takes about ten seconds.">
      <form
        onSubmit={handleSubmit((v) => {
          setError(null);
          signup.mutate(v);
        })}
        className="space-y-4"
      >
        <Field label="Your name" htmlFor="displayName" error={formState.errors.displayName?.message}>
          <Input id="displayName" autoComplete="name" {...register('displayName')} />
        </Field>
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            {...register('password')}
          />
        </Field>
        <Field label="Home currency" htmlFor="homeCurrency" error={formState.errors.homeCurrency?.message}>
          <select
            id="homeCurrency"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            {...register('homeCurrency')}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <FormError error={error} />
        <Button type="submit" disabled={signup.isPending} className="w-full">
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <GoogleButton navigate={navigate} />
      <button onClick={() => navigate('/sign-in')} className="text-xs text-slate-500 hover:underline">
        Already have an account? Sign in
      </button>
    </AuthCard>
  );
}
