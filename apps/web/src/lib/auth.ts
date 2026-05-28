import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** undefined while we're checking session via refresh on app start */
  ready: boolean;

  setSession: (
    user: AuthUser | null,
    token: string | null,
  ) => void;
  setReady: () => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  ready: false,

  setSession: (user, token) => set({ user, accessToken: token }),
  setReady: () => set({ ready: true }),
  clear: () => set({ user: null, accessToken: null }),
}));

/** Reach in synchronously — used by the tRPC fetch wrapper. */
export const getAccessToken = () => useAuth.getState().accessToken;
