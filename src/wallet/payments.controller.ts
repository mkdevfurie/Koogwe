// src/wallet/payments.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@ApiTags('Payments (Compatibility)')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly walletService: WalletService) {}

  @Post('authorize')
  @ApiOperation({ summary: 'Autoriser un paiement (Simulé)' })
  async authorize(@Req() req: any, @Body() body: any) {
    this.logger.log(`[Payments] Authorize called for user ${req.user.id}`);
    return { success: true, message: 'Paiement autorisé', status: 'AUTHORIZED' };
  }

  @Post('finalize')
  @ApiOperation({ summary: 'Finaliser un paiement (Simulé)' })
  async finalize(@Req() req: any, @Body() body: any) {
    this.logger.log(`[Payments] Finalize called for user ${req.user.id}`);
    return { success: true, message: 'Paiement finalisé', status: 'COMPLETED' };
  }

  @Post('release-auth')
  async release(@Req() req: any) {
    return { success: true };
  }

  @Post('refund')
  async refund(@Req() req: any) {
    return { success: true };
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique des paiements' })
  async getHistory(@Req() req: any) {
    // Redirige vers l'historique du wallet
    return this.walletService.getTransactionHistory(req.user.id);
  }

  @Get(':rideId/status')
  async getStatus(@Param('rideId') rideId: string) {
    return { status: 'COMPLETED', rideId };
  }

  @Post('transfer-driver')
  async transferDriver(@Body() body: any) {
    return { success: true, message: 'Transfert effectué' };
  }
}
