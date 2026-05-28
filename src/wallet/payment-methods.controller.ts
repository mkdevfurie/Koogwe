// src/wallet/payment-methods.controller.ts
import { Controller, Post, Get, Delete, Body, Req, UseGuards, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@ApiTags('Payment Methods')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private walletService: WalletService) {}

  @Get('stripe-config')
  @ApiOperation({ summary: 'Configuration Stripe côté client (clé publique)' })
  getStripeConfig() {
    return this.walletService.getStripeConfig();
  }

  @Post('setup-intent')
  @ApiOperation({ summary: 'Créer un SetupIntent pour enregistrer une carte (Payment Sheet)' })
  createSetupIntent(@Req() req: any) {
    return this.walletService.createSetupIntent(req.user.id);
  }

  @Post('card/confirm')
  @ApiOperation({ summary: 'Confirmer une carte après SetupIntent Stripe' })
  confirmCard(@Req() req: any, @Body() dto: { setupIntentId: string }) {
    return this.walletService.confirmCardFromSetupIntent(req.user.id, dto.setupIntentId);
  }

  @Post('card')
  @ApiOperation({ summary: 'Enregistrer une carte bancaire (PaymentMethod ID Stripe)' })
  async saveCard(@Req() req: any, @Body() dto: { stripeMethodId: string }) {
    return this.walletService.saveCard(req.user.id, dto.stripeMethodId);
  }

  @Get('cards')
  @ApiOperation({ summary: 'Liste des cartes enregistrées' })
  async listCards(@Req() req: any) {
    return this.walletService.listCards(req.user.id);
  }

  @Delete('cards/:id')
  @ApiOperation({ summary: 'Supprimer une carte' })
  async deleteCard(@Req() req: any, @Param('id') cardId: string) {
    return this.walletService.deleteCard(req.user.id, cardId);
  }
}
