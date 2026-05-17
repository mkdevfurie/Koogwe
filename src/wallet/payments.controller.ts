// src/wallet/payments.controller.ts
// 🔧 Compatibilité : les apps appellent /payments/* mais on redirige tout vers le wallet.
//    CARD/PAYPAL sont automatiquement convertis en CASH ou WALLET selon le contexte.

import { Controller, Get, Post, Body, Param, UseGuards, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Payments (Compatibility)')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Autorise le paiement : ne fait rien côté Stripe (mode démo),
   * mais retourne un statut compatible avec ce que l'app attend.
   */
  @Post('authorize')
  @ApiOperation({ summary: 'Autoriser un paiement' })
  async authorize(@Req() req: any, @Body() body: { rideId?: string; amount?: number }) {
    this.logger.log(`[Payments] Authorize user=${req.user.id} ride=${body?.rideId} amount=${body?.amount}`);
    return {
      success: true,
      message: 'Paiement autorisé',
      status: 'AUTHORIZED',
      transactionId: `auth_${Date.now()}_${req.user.id.substring(0, 8)}`,
    };
  }

  /**
   * Finalise le paiement : enregistre la transaction selon le mode (cash ou wallet).
   * Met à jour la course en isPaid=true.
   */
  @Post('finalize')
  @ApiOperation({ summary: 'Finaliser un paiement' })
  async finalize(
    @Req() req: any,
    @Body() body: { rideId: string; amount: number; paymentMethod?: string },
  ) {
    const userId = req.user.id;
    const { rideId, amount } = body;
    const paymentMethod = (body.paymentMethod || 'CASH').toUpperCase();

    if (!rideId || !amount || amount <= 0) {
      return { success: false, message: 'Paramètres invalides' };
    }

    this.logger.log(`[Payments] Finalize user=${userId} ride=${rideId} method=${paymentMethod} amount=${amount}`);

    // CARD/PAYPAL → on traite comme CASH pour la démo
    if (paymentMethod === 'WALLET') {
      const result = await this.walletService.payRideFromWallet(userId, rideId, amount);
      return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
    } else {
      // CASH par défaut (et tout autre méthode non supportée tombe ici)
      const result = await this.walletService.recordCashPayment(userId, rideId, amount);
      return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
    }
  }

  @Post('release-auth')
  async release(@Req() req: any) {
    return { success: true, message: 'Autorisation libérée' };
  }

  @Post('refund')
  async refund(@Req() req: any, @Body() body: { rideId?: string }) {
    return { success: true, message: 'Remboursement enregistré', rideId: body?.rideId };
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique des paiements' })
  async getHistory(@Req() req: any) {
    return this.walletService.getTransactionHistory(req.user.id);
  }

  @Get(':rideId/status')
  async getStatus(@Param('rideId') rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, isPaid: true, finalPrice: true, estimatedPrice: true, paymentMethod: true },
    });
    if (!ride) return { status: 'NOT_FOUND', rideId };
    return {
      status: ride.isPaid ? 'COMPLETED' : 'PENDING',
      rideId: ride.id,
      amount: ride.finalPrice ?? ride.estimatedPrice,
      method: ride.paymentMethod,
    };
  }

  @Post('transfer-driver')
  async transferDriver(@Body() body: any) {
    return { success: true, message: 'Transfert effectué' };
  }
}