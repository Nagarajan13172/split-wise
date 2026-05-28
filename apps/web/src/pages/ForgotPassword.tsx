import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, Banner, Button, Field, FormError, Input } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import type { NavigateFn } from '../router.js';

const schema = z.object({ email: z.string().email() });
type Values = z.infer<typeof schema>;

export function ForgotPassword({ navigate }: { navigate: NavigateFn }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const req = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
    onError: (err) => setError(err.message),
  });

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a reset link.">
      {sent ? (
        <Banner kind="success">
          If an account exists for that email, a reset link has been sent. Check your inbox.
        </Banner>
      ) : (
        <form
          onSubmit={handleSubmit((v) => {
            setError(null);
            req.mutate(v);
          })}
          className="space-y-4"
        >
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={req.isPending} className="w-full">
            {req.isPending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <button onClick={() => navigate('/sign-in')} className="text-xs text-slate-500 hover:underline">
        Back to sign in
      </button>
    </AuthCard>
  );
}
