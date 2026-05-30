// src/rides/rides.module.ts
import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { CommonModule } from '../common/common.module';
import { AdminModule } from '../admin/admin.module';
import { WalletModule } from '../wallet/wallet.module';
import { PromosModule } from '../promos/promos.module';

@Module({
  imports: [CommonModule, AdminModule, WalletModule, PromosModule],
  controllers: [RidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}