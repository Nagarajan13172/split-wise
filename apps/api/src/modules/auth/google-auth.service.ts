import { Injectable, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { loadEnv } from '../../config/env.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

/** Verifies Google-issued ID tokens against Google's JWKS. */
@Injectable()
export class GoogleAuthService {
  private readonly log = new Logger(GoogleAuthService.name);
  private readonly client: OAuth2Client | null;
  private readonly clientId: string | null;

  constructor() {
    const env = loadEnv();
    this.clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? null;
    this.client = this.clientId ? new OAuth2Client(this.clientId) : null;
    if (!this.clientId) {
      this.log.warn('GOOGLE_OAUTH_CLIENT_ID not set — Google sign-in disabled');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.client || !this.clientId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Google sign-in is not configured on this server.',
      });
    }
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.log.warn({ err }, 'Google ID token verification failed');
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid Google credential' });
    }
    if (!payload?.sub || !payload.email) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'incomplete Google identity' });
    }
    if (!payload.email_verified) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Google email is not verified',
      });
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: true,
      name: payload.name ?? payload.email.split('@')[0]!,
      picture: payload.picture,
    };
  }
}
