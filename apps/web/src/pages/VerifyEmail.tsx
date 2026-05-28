import { useEffect, useRef, useState } from 'react';
import { AuthCard, Banner, Button } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import type { NavigateFn } from '../router.js';

export function VerifyEmail({ token, navigate }: { token: string; navigate: NavigateFn }) {
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const verify = trpc.auth.verifyEmail.useMutation();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
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
  }, []);

  return (
    <AuthCard title="Verify email">
      {status === 'pending' && <Banner kind="info">Verifying…</Banner>}
      {status === 'ok' && (
        <div className="space-y-3">
          <Banner kind="success">Your email is verified.</Banner>
          <Button onClick={() => navigate('/')} className="w-full">
            Continue
          </Button>
        </div>
      )}
      {status === 'error' && (
        <div className="space-y-3">
          <Banner kind="info">{error ?? 'Verification failed.'}</Banner>
          <Button onClick={() => navigate('/sign-in')} className="w-full">
            Back to sign in
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
