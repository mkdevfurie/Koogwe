// src/wallet/wallet.module.ts
import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentsController } from './payments.controller';
import { WalletService } from './wallet.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [WalletController, PaymentMethodsController, PaymentsController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
