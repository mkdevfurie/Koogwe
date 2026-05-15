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

  @Post('card')
  @ApiOperation({ summary: 'Enregistrer une carte bancaire' })
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
