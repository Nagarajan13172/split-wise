import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { ReceiptsModule } from '../receipts/receipts.module.js';
import { FxModule } from '../fx/fx.module.js';
import { UsersModule } from '../users/users.module.js';
import { BalancesService } from './balances.service.js';
import { ExpensesService } from './expenses.service.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [GroupsModule, ReceiptsModule, FxModule, UsersModule],
  providers: [ExpensesService, SettlementsService, BalancesService],
  exports: [ExpensesService, SettlementsService, BalancesService],
})
export class ExpensesModule {}
