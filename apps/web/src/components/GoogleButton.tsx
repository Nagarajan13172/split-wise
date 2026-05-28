import { GoogleLogin } from '@react-oauth/google';
import { useState } from 'react';
import { trpc } from '../lib/trpc.js';
import { useAuth } from '../lib/auth.js';
import { FormError } from './ui.js';
import type { NavigateFn } from '../router.js';
import { googleEnabled } from '../lib/google.js';
import { popPendingInviteToken } from '../pages/InviteAccept.js';

export function GoogleButton({ navigate }: { navigate: NavigateFn }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.auth.googleSignIn.useMutation({
    onSuccess: (data) => {
      useAuth.getState().setSession(data.user, data.accessToken);
      const pending = popPendingInviteToken();
      navigate(pending ? `/invite/${encodeURIComponent(pending)}` : '/');
    },
    onError: (err) => setError(err.message),
  });

  if (!googleEnabled) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs uppercase tracking-wide text-slate-400">or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="flex justify-center">
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            setError(null);
            const idToken = credentialResponse.credential;
            if (!idToken) {
              setError('Google did not return a credential — try again.');
              return;
            }
            mutation.mutate({ idToken });
          }}
          onError={() => setError('Google sign-in was cancelled or failed.')}
          theme="outline"
          size="large"
          text="continue_with"
          width="320"
        />
      </div>
      <FormError error={error} />
    </div>
  );
}
