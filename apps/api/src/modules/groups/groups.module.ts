import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { GroupsService } from './groups.service.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [AuthModule, UsersModule],
  providers: [GroupsService, InvitesService],
  exports: [GroupsService, InvitesService],
})
export class GroupsModule {}
