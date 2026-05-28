import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthService } from './auth.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [UsersModule],
  providers: [AuthService, PasswordService, TokensService, GoogleAuthService],
  exports: [AuthService, PasswordService, TokensService, GoogleAuthService],
})
export class AuthModule {}
