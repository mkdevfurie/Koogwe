// src/wallet/wallet.controller.ts
import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Solde du wallet' })
  getBalance(@Req() req: any) {
    return this.walletService.getBalance(req.user.id);
  }

  @Post('pay-ride')
  payRide(@Req() req: any, @Body() dto: { rideId: string; amount?: number }) {
    return this.walletService.payRideFromWallet(req.user.id, dto.rideId, dto.amount);
  }

  @Post('record-cash')
  recordCash(@Req() req: any, @Body() dto: { rideId: string; amount?: number }) {
    return this.walletService.recordCashPayment(req.user.id, dto.rideId, dto.amount);
  }

  @Post('request-withdrawal')
  requestWithdrawal(@Req() req: any, @Body() dto: { amount: number }) {
    return this.walletService.requestWithdrawal(req.user.id, dto.amount);
  }

  @Get('transactions')
  getTransactions(@Req() req: any) {
    return this.walletService.getTransactionHistory(req.user.id);
  }

  @Post('create-recharge-intent')
  createRechargeIntent(@Req() req: any, @Body() dto: { amount: number }) {
    return this.walletService.createRechargeIntent(req.user.id, dto.amount);
  }

  @Post('confirm-recharge')
  confirmRecharge(@Req() req: any, @Body() dto: { paymentIntentId: string }) {
    return this.walletService.confirmRechargeIntent(dto.paymentIntentId, req.user.id);
  }
}
