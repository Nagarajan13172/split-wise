import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** Argon2id is the OWASP recommendation for password hashing since 2021. */
@Injectable()
export class PasswordService {
  private readonly options = {
    type: argon2.argon2id,
    // OWASP minimums (Aug 2023): memory 19 MiB, iterations 2, parallelism 1.
    // We crank up memory for stronger resistance on a low-traffic server.
    memoryCost: 64 * 1024, // 64 MiB
    timeCost: 3,
    parallelism: 1,
  } as const;

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
