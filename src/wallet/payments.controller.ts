// src/wallet/payments.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
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

  @Post('authorize')
  @ApiOperation({ summary: 'Autoriser un paiement' })
  async authorize(
    @Req() req: any,
    @Body() body: { rideId?: string; amount?: number; method?: string; paymentMethod?: string },
  ) {
    if (!body?.rideId) {
      throw new BadRequestException('rideId requis');
    }
    this.logger.log(`[Payments] Authorize user=${req.user.id} ride=${body.rideId}`);
    const method = body.method ?? body.paymentMethod;
    return this.walletService.authorizeRidePayment(req.user.id, body.rideId, method);
  }

  @Post('finalize')
  @ApiOperation({ summary: 'Finaliser un paiement' })
  async finalize(
    @Req() req: any,
    @Body()
    body: {
      rideId: string;
      amount?: number;
      finalAmount?: number;
      paymentMethod?: string;
      method?: string;
    },
  ) {
    const userId = req.user.id;
    const { rideId } = body;

    if (!rideId) {
      throw new BadRequestException('rideId requis');
    }

    const clientAmount = body.finalAmount ?? body.amount;
    if (clientAmount != null) {
      const { amount: serverAmount } = await this.walletService.resolveChargeAmount(rideId, userId);
      if (Math.abs(clientAmount - serverAmount) > 0.01) {
        throw new BadRequestException('Montant invalide');
      }
    }

    const paymentMethod = (body.paymentMethod || body.method || 'CASH').toUpperCase();
    this.logger.log(`[Payments] Finalize user=${userId} ride=${rideId} method=${paymentMethod}`);

    if (paymentMethod === 'WALLET') {
      const result = await this.walletService.payRideFromWallet(userId, rideId);
      return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
    }
    if (paymentMethod === 'CARD') {
      const result = await this.walletService.payRideFromCard(userId, rideId);
      return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
    }
    if (paymentMethod === 'PAYPAL') {
      if ((process.env.PAYPAL_ENABLED ?? 'false').toLowerCase() !== 'true') {
        return {
          success: false,
          status: 'FAILED',
          message: 'PayPal indisponible en production sur cette version',
        };
      }
      const result = await this.walletService.payRideFromPaypal(userId, rideId);
      return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
    }

    const result = await this.walletService.recordCashPayment(userId, rideId);
    return { ...result, status: result.success ? 'COMPLETED' : 'FAILED' };
  }

  @Post('release-auth')
  async release() {
    return { success: true, message: 'Autorisation libérée' };
  }

  @Post('refund')
  async refund(@Body() body: { rideId?: string }) {
    return { success: true, message: 'Remboursement enregistré', rideId: body?.rideId };
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique des paiements' })
  async getHistory(@Req() req: any) {
    return this.walletService.getTransactionHistory(req.user.id);
  }

  @Get(':rideId/status')
  async getStatus(@Param('rideId') rideId: string, @Req() req: any) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        isPaid: true,
        finalPrice: true,
        estimatedPrice: true,
        paymentMethod: true,
        passengerId: true,
        driverId: true,
      },
    });
    if (!ride) return { status: 'NOT_FOUND', rideId };
    if (ride.passengerId !== req.user.id && ride.driverId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new BadRequestException('Course introuvable');
    }
    return {
      status: ride.isPaid ? 'COMPLETED' : 'PENDING',
      rideId: ride.id,
      amount: ride.finalPrice ?? ride.estimatedPrice,
      method: ride.paymentMethod,
    };
  }

  @Post('transfer-driver')
  async transferDriver() {
    return { success: true, message: 'Transfert effectué' };
  }
}
