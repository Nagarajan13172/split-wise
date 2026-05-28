import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { loadEnv } from '../../config/env.js';

export interface AccessTokenClaims {
  sub: string; // userId
  sid: string; // sessionId (= refresh token familyId — lets us revoke a session)
}

export interface AccessTokenResult {
  token: string;
  expiresAt: Date;
}

export interface RefreshTokenResult {
  /** raw token to return to the client */
  raw: string;
  /** SHA-256 hex hash to store */
  hash: string;
  expiresAt: Date;
}

@Injectable()
export class TokensService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  signAccessToken(claims: AccessTokenClaims): AccessTokenResult {
    const env = loadEnv();
    const expiresAt = new Date(Date.now() + env.JWT_ACCESS_TTL_SECONDS * 1000);
    const token = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      jwtid: crypto.randomUUID(),
    });
    return { token, expiresAt };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const env = loadEnv();
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      if (typeof decoded === 'string' || !decoded.sub || !('sid' in decoded)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid token shape' });
      }
      return { sub: String(decoded.sub), sid: String(decoded.sid) };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid or expired token' });
    }
  }

  /** Generate a fresh opaque refresh token. */
  newRefreshToken(): RefreshTokenResult {
    const env = loadEnv();
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    return { raw, hash, expiresAt };
  }

  hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Rotate a refresh token: validate the incoming raw token, revoke it, and issue a new
   * one in the same family. If the incoming token is revoked, REUSED-token attack is
   * assumed — revoke the entire family and reject.
   */
  async rotateRefreshToken(input: {
    rawToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{
    userId: string;
    sessionId: string;
    refresh: RefreshTokenResult;
  }> {
    const hash = this.hashToken(input.rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!existing) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'refresh token not recognized' });
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'refresh token expired' });
    }
    if (existing.revokedAt) {
      // Token reuse — kill the whole family.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'refresh token reuse detected; session revoked',
      });
    }

    const fresh = this.newRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: fresh.hash,
          familyId: existing.familyId,
          expiresAt: fresh.expiresAt,
          userAgent: input.userAgent,
          ip: input.ip,
        },
      }),
    ]);

    return { userId: existing.userId, sessionId: existing.familyId, refresh: fresh };
  }

  async issueRefreshTokenForNewSession(input: {
    userId: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ sessionId: string; refresh: RefreshTokenResult }> {
    const fresh = this.newRefreshToken();
    const familyId = crypto.randomUUID();
    await this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: fresh.hash,
        familyId,
        expiresAt: fresh.expiresAt,
        userAgent: input.userAgent,
        ip: input.ip,
      },
    });
    return { sessionId: familyId, refresh: fresh };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
