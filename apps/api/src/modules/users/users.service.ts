import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  createLocal(input: {
    email: string;
    displayName: string;
    homeCurrency: string;
    passwordHash: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        homeCurrency: input.homeCurrency,
        passwordHash: input.passwordHash,
      },
    });
  }

  findByGoogleSub(googleSub: string) {
    return this.prisma.user.findUnique({ where: { googleSub } });
  }

  createGoogle(input: {
    email: string;
    displayName: string;
    googleSub: string;
    homeCurrency?: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        homeCurrency: input.homeCurrency ?? 'USD',
        authProvider: 'GOOGLE',
        googleSub: input.googleSub,
        emailVerifiedAt: new Date(),
      },
    });
  }

  markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  updateHomeCurrency(userId: string, homeCurrency: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { homeCurrency },
    });
  }
}
