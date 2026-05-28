import * as SecureStore from 'expo-secure-store';

const KEY = 'splitwise.pendingInviteToken';

/** Save an invite token so we can redeem it after the user finishes auth. */
export async function stashPendingInviteToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token);
}

/** Pop the stashed invite token (if any) — returns null if none. */
export async function popPendingInviteToken(): Promise<string | null> {
  const t = await SecureStore.getItemAsync(KEY);
  if (t) await SecureStore.deleteItemAsync(KEY);
  return t;
}
