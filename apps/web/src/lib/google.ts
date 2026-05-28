/** Client ID is loaded at build time from root .env via Vite's envDir config. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const googleEnabled = !!GOOGLE_CLIENT_ID;
