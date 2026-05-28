import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { BalancesService } from './balances.service.js';
import { ExpensesService } from './expenses.service.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [GroupsModule],
  providers: [ExpensesService, SettlementsService, BalancesService],
  exports: [ExpensesService, SettlementsService, BalancesService],
})
export class ExpensesModule {}
