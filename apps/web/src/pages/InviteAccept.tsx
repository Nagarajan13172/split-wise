import { useEffect, useState } from 'react';
import { AuthCard, Banner, Button, FormError } from '../components/ui.js';
import { trpc } from '../lib/trpc.js';
import { useAuth } from '../lib/auth.js';
import { navigate } from '../router.js';

const STASH_KEY = 'pending-invite-token';

/** Pop any invite token stashed before sign-in, so the auth screens can redirect back. */
export function popPendingInviteToken(): string | null {
  const t = sessionStorage.getItem(STASH_KEY);
  if (t) sessionStorage.removeItem(STASH_KEY);
  return t;
}

export function InviteAccept({ token }: { token: string }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const preview = trpc.groups.previewInvite.useQuery({ token }, { retry: false });
  const [error, setError] = useState<string | null>(null);
  const accept = trpc.groups.acceptInvite.useMutation({
    onSuccess: async (data) => {
      await utils.groups.list.invalidate();
      navigate(`/groups/${data.groupId}`);
    },
    onError: (err) => setError(err.message),
  });

  // If user is not signed in, stash the token and bounce to sign-in.
  useEffect(() => {
    if (!user && token) {
      sessionStorage.setItem(STASH_KEY, token);
    }
  }, [user, token]);

  if (preview.isLoading) {
    return (
      <AuthCard title="Loading invite…">
        <Banner kind="info">Checking the invite link…</Banner>
      </AuthCard>
    );
  }
  if (preview.error) {
    return (
      <AuthCard title="Invite unavailable">
        <FormError error={preview.error.message} />
        <Button onClick={() => navigate('/')}>Continue</Button>
      </AuthCard>
    );
  }
  if (!preview.data) return null;

  if (!user) {
    return (
      <AuthCard
        title={`Join "${preview.data.groupName}"`}
        subtitle={`Invited by ${preview.data.invitedBy}`}
      >
        <Banner kind="info">
          Sign in to accept this invite. We'll bring you back here after.
        </Banner>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/sign-in')} className="flex-1">
            Sign in
          </Button>
          <Button variant="ghost" onClick={() => navigate('/sign-up')} className="flex-1">
            Create account
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join "${preview.data.groupName}"`}
      subtitle={`Invited by ${preview.data.invitedBy}`}
    >
      <p className="text-sm text-slate-600">
        Default currency: {preview.data.defaultCurrency}
      </p>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setError(null);
            accept.mutate({ token });
          }}
          disabled={accept.isPending}
          className="flex-1"
        >
          {accept.isPending ? 'Joining…' : 'Accept invite'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/')} className="flex-1">
          Cancel
        </Button>
      </div>
    </AuthCard>
  );
}
