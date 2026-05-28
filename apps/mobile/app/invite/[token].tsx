import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  ErrorBanner,
  H1,
  InfoBanner,
  Screen,
  Sub,
} from '../../src/components/ui';
import { trpc } from '../../src/lib/trpc';
import { useAuth } from '../../src/lib/auth';
import { stashPendingInviteToken } from '../../src/lib/pending-invite';

export default function InviteAcceptScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token: string }>();
  const token = String(params.token);
  const { user } = useAuth();

  const preview = trpc.groups.previewInvite.useQuery({ token }, { retry: false });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const accept = trpc.groups.acceptInvite.useMutation({
    onSuccess: async (data) => {
      await utils.groups.list.invalidate();
      router.replace(`/groups/${data.groupId}`);
    },
    onError: (err) => setError(err.message),
  });

  // If not signed in, stash the token so SignIn/SignUp can pick it up afterwards.
  useEffect(() => {
    if (!user && token) {
      void stashPendingInviteToken(token);
    }
  }, [user, token]);

  if (preview.isLoading) {
    return (
      <Screen>
        <H1>Loading invite…</H1>
        <View className="mt-6">
          <InfoBanner>Checking the invite link…</InfoBanner>
        </View>
      </Screen>
    );
  }
  if (preview.error) {
    return (
      <Screen>
        <H1>Invite unavailable</H1>
        <View className="mt-6 gap-3">
          <ErrorBanner error={preview.error.message} />
          <Button onPress={() => router.replace('/')}>Continue</Button>
        </View>
      </Screen>
    );
  }
  if (!preview.data) return null;

  if (!user) {
    return (
      <Screen>
        <H1>Join "{preview.data.groupName}"</H1>
        <Sub>Invited by {preview.data.invitedBy}</Sub>
        <View className="mt-8 gap-3">
          <InfoBanner>
            Sign in to accept this invite. We'll bring you back here after.
          </InfoBanner>
          <Button onPress={() => router.replace('/sign-in')}>Sign in</Button>
          <Button variant="ghost" onPress={() => router.replace('/sign-up')}>
            Create account
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>Join "{preview.data.groupName}"</H1>
      <Sub>Invited by {preview.data.invitedBy}</Sub>
      <View className="mt-8 gap-3">
        <Text className="text-sm text-slate-600">
          Default currency: {preview.data.defaultCurrency}
        </Text>
        <ErrorBanner error={error} />
        <Button
          onPress={() => {
            setError(null);
            accept.mutate({ token });
          }}
          loading={accept.isPending}
          disabled={accept.isPending}
        >
          Accept invite
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/')}>
          Cancel
        </Button>
      </View>
    </Screen>
  );
}
