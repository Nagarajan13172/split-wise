import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, Banner, Button, Field, FormError, Input } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import type { NavigateFn } from '../router.js';

const schema = z.object({ newPassword: z.string().min(10).max(128) });
type Values = z.infer<typeof schema>;

export function ResetPassword({ token, navigate }: { token: string; navigate: NavigateFn }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const confirm = trpc.auth.confirmPasswordReset.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => setError(err.message),
  });

  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <div className="space-y-3">
          <Banner kind="success">Password updated. You can sign in now.</Banner>
          <Button onClick={() => navigate('/sign-in')} className="w-full">
            Go to sign in
          </Button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit((v) => {
            setError(null);
            confirm.mutate({ token, newPassword: v.newPassword });
          })}
          className="space-y-4"
        >
          <Field label="New password" htmlFor="newPassword" error={formState.errors.newPassword?.message}>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              {...register('newPassword')}
            />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={confirm.isPending} className="w-full">
            {confirm.isPending ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
