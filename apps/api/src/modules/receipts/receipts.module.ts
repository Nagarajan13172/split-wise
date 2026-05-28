import { Module } from '@nestjs/common';
import { S3Module } from '../../common/s3/s3.module.js';
import { QueueModule } from '../../common/queue/queue.module.js';
import { ReceiptsService } from './receipts.service.js';

@Module({
  imports: [S3Module, QueueModule],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
