import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { EmailService } from '../../common/email/email.service.js';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service.js';
import { loadEnv } from '../../config/env.js';
import { UsersService } from '../users/users.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';

const EMAIL_VERIFY_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 1;

export interface AuthResult {
  user: { id: string; email: string; displayName: string };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(GoogleAuthService) private readonly google: GoogleAuthService,
  ) {}

  async signup(input: {
    email: string;
    password: string;
    displayName: string;
    homeCurrency: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    await this.rateLimit.consume({
      key: `auth:signup:ip:${input.ip ?? 'unknown'}`,
      limit: 5,
      windowSeconds: 3600,
    });

    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'an account with this email exists' });
    }

    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.createLocal({
      email: input.email,
      displayName: input.displayName,
      homeCurrency: input.homeCurrency,
      passwordHash,
    });

    await this.sendVerificationEmail(user.id, user.email);

    return this.issueSession(user, { ip: input.ip, userAgent: input.userAgent });
  }

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    await this.rateLimit.consume({
      key: `auth:login:email:${input.email.toLowerCase()}`,
      limit: 10,
      windowSeconds: 3600,
    });
    await this.rateLimit.consume({
      key: `auth:login:ip:${input.ip ?? 'unknown'}`,
      limit: 30,
      windowSeconds: 60,
    });

    const user = await this.users.findByEmail(input.email);
    if (!user || !user.passwordHash) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid email or password' });
    }
    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid email or password' });
    }
    return this.issueSession(user, { ip: input.ip, userAgent: input.userAgent });
  }

  async refresh(input: {
    refreshToken: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    const rotated = await this.tokens.rotateRefreshToken({
      rawToken: input.refreshToken,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    const user = await this.users.findById(rotated.userId);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'user not found' });
    }
    const access = this.tokens.signAccessToken({ sub: user.id, sid: rotated.sessionId });
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: rotated.refresh.raw,
      refreshTokenExpiresAt: rotated.refresh.expiresAt.toISOString(),
    };
  }

  /**
   * Verify a Google ID token and sign in an existing Google user or create one.
   * Email collision with a LOCAL user is rejected — they must password-login
   * first and link Google from settings. Prevents takeover via email squatting.
   */
  async googleSignIn(input: {
    idToken: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    const identity = await this.google.verify(input.idToken);

    const byGoogleSub = await this.users.findByGoogleSub(identity.sub);
    if (byGoogleSub) {
      return this.issueSession(byGoogleSub, { ip: input.ip, userAgent: input.userAgent });
    }

    const byEmail = await this.users.findByEmail(identity.email);
    if (byEmail) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'An account with this email already exists. Sign in with your password, then link Google from Settings.',
      });
    }

    const user = await this.users.createGoogle({
      email: identity.email,
      displayName: identity.name,
      googleSub: identity.sub,
    });
    return this.issueSession(user, { ip: input.ip, userAgent: input.userAgent });
  }

  async logout(input: { refreshToken: string }): Promise<void> {
    const hash = this.tokens.hashToken(input.refreshToken);
    const found = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (found) await this.tokens.revokeSession(found.familyId);
  }

  async requestEmailVerification(input: { userId: string }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerificationEmail(user.id, user.email);
  }

  async verifyEmail(input: { token: string }): Promise<void> {
    const tokenHash = this.tokens.hashToken(input.token);
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.kind !== 'EMAIL_VERIFY') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid verification token' });
    }
    if (record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'verification token expired' });
    }
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }

  /** Always returns successfully — don't leak email existence. */
  async requestPasswordReset(input: { email: string; ip?: string }): Promise<void> {
    await this.rateLimit.consume({
      key: `auth:reset-request:ip:${input.ip ?? 'unknown'}`,
      limit: 5,
      windowSeconds: 3600,
    });
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      // Silently succeed.
      this.log.debug({ email: input.email }, 'reset requested for unknown email — ignored');
      return;
    }

    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this.tokens.hashToken(raw);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
    await this.prisma.verificationToken.create({
      data: { userId: user.id, kind: 'PASSWORD_RESET', tokenHash, expiresAt },
    });
    const url = `${loadEnv().APP_BASE_URL}/reset-password?token=${encodeURIComponent(raw)}`;
    await this.email.send({
      to: user.email,
      subject: 'Reset your Splitwise password',
      text: `Reset your password: ${url}\n\nThis link expires in 1 hour.`,
      html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 1 hour.</p>`,
    });
  }

  async confirmPasswordReset(input: { token: string; newPassword: string }): Promise<void> {
    const tokenHash = this.tokens.hashToken(input.token);
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.kind !== 'PASSWORD_RESET') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid reset token' });
    }
    if (record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'reset token expired' });
    }
    const newHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash },
      }),
    ]);
    // Invalidate every session for this user.
    await this.tokens.revokeAllSessionsForUser(record.userId);
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this.tokens.hashToken(raw);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);
    await this.prisma.verificationToken.create({
      data: { userId, kind: 'EMAIL_VERIFY', tokenHash, expiresAt },
    });
    const url = `${loadEnv().APP_BASE_URL}/verify-email?token=${encodeURIComponent(raw)}`;
    await this.email.send({
      to: email,
      subject: 'Verify your Splitwise email',
      text: `Verify your email: ${url}\n\nThis link expires in 24 hours.`,
      html: `<p>Welcome to Splitwise! Verify your email:</p><p><a href="${url}">${url}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  private async issueSession(
    user: { id: string; email: string; displayName: string },
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const session = await this.tokens.issueRefreshTokenForNewSession({
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const access = this.tokens.signAccessToken({ sub: user.id, sid: session.sessionId });
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: session.refresh.raw,
      refreshTokenExpiresAt: session.refresh.expiresAt.toISOString(),
    };
  }
}
