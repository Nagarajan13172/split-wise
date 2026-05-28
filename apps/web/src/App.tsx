import { useEffect } from 'react';
import { useAuth } from './lib/auth.js';
import { bootstrapSession } from './lib/trpc.js';
import { navigate, useLocation } from './router.js';
import { SignIn } from './pages/SignIn.js';
import { SignUp } from './pages/SignUp.js';
import { ForgotPassword } from './pages/ForgotPassword.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { VerifyEmail } from './pages/VerifyEmail.js';
import { Groups } from './pages/Groups.js';
import { GroupDetail } from './pages/GroupDetail.js';
import { InviteAccept } from './pages/InviteAccept.js';

export function App() {
  const { user, ready } = useAuth();
  const loc = useLocation();

  useEffect(() => {
    void bootstrapSession();
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  // Public token-bearing pages render regardless of auth state.
  if (loc.path === '/verify-email') {
    const token = loc.search.get('token') ?? '';
    return <VerifyEmail token={token} navigate={navigate} />;
  }
  if (loc.path === '/reset-password') {
    const token = loc.search.get('token') ?? '';
    return <ResetPassword token={token} navigate={navigate} />;
  }
  // Invite acceptance can be hit signed-out (stashes token, prompts sign-in)
  // or signed-in (one-tap accept).
  const inviteMatch = loc.path.match(/^\/invite\/(.+)$/);
  if (inviteMatch) {
    return <InviteAccept token={decodeURIComponent(inviteMatch[1]!)} />;
  }

  if (!user) {
    if (loc.path === '/sign-up') return <SignUp navigate={navigate} />;
    if (loc.path === '/forgot-password') return <ForgotPassword navigate={navigate} />;
    return <SignIn navigate={navigate} />;
  }

  // Authed routes
  const groupMatch = loc.path.match(/^\/groups\/(.+)$/);
  if (groupMatch) {
    return <GroupDetail groupId={groupMatch[1]!} />;
  }
  return <Groups />;
}
