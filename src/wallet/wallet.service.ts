// src/wallet/wallet.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async getBalance(userId: string): Promise<{ balance: number }> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return { balance: wallet?.balance ?? 0 };
  }

  async rechargeManual(userId: string, amount: number): Promise<{ success: boolean; message: string; balance?: number }> {
    try {
      const wallet = await this.prisma.$transaction([
        this.prisma.wallet.update({ where: { userId }, data: { balance: { increment: amount } } }),
        this.prisma.transaction.create({
          data: { userId, type: 'RECHARGE', amount, status: 'COMPLETED', paymentMethod: 'CARD', reference: `MANUAL-${Date.now()}` },
        }),
      ]);
      return { success: true, message: 'Recharge effectuée', balance: wallet[0].balance };
    } catch (error) {
      this.logger.error('Erreur recharge:', error);
      return { success: false, message: 'Erreur lors de la recharge' };
    }
  }

  async payRideFromWallet(userId: string, rideId: string, amount: number): Promise<{ success: boolean; message: string }> {
    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < amount) return { success: false, message: 'Solde insuffisant' };

      const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
      if (!ride || !ride.driverId) return { success: false, message: 'Course introuvable' };

      await this.prisma.$transaction([
        this.prisma.wallet.update({ where: { userId }, data: { balance: { decrement: amount } } }),
        this.prisma.wallet.update({ where: { userId: ride.driverId }, data: { balance: { increment: amount * 0.8 } } }),
        this.prisma.transaction.create({ data: { userId, type: 'PAYMENT', amount: -amount, status: 'COMPLETED', rideId, paymentMethod: 'WALLET' } }),
        this.prisma.transaction.create({ data: { userId: ride.driverId, type: 'RECHARGE', amount: amount * 0.8, status: 'COMPLETED', rideId, paymentMethod: 'WALLET' } }),
        this.prisma.ride.update({ where: { id: rideId }, data: { isPaid: true } }),
      ]);

      return { success: true, message: 'Paiement réussi' };
    } catch (error) {
      this.logger.error('Erreur paiement wallet:', error);
      return { success: false, message: 'Erreur lors du paiement' };
    }
  }

  async recordCashPayment(userId: string, rideId: string, amount: number): Promise<{ success: boolean; message: string }> {
    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
      if (!ride || ride.passengerId !== userId) return { success: false, message: 'Course introuvable ou non autorisée' };

      await this.prisma.$transaction([
        this.prisma.transaction.create({ data: { userId, type: 'PAYMENT', amount: -amount, status: 'COMPLETED', rideId, paymentMethod: 'CASH' } }),
        ...(ride.driverId ? [
          this.prisma.transaction.create({ data: { userId: ride.driverId, type: 'RECHARGE', amount, status: 'COMPLETED', rideId, paymentMethod: 'CASH' } }),
        ] : []),
        this.prisma.ride.update({ where: { id: rideId }, data: { isPaid: true } }),
      ]);

      return { success: true, message: 'Paiement cash enregistré' };
    } catch (error) {
      this.logger.error('Erreur cash:', error);
      return { success: false, message: 'Erreur lors de l\'enregistrement' };
    }
  }

  async requestWithdrawal(userId: string, amount: number): Promise<{ success: boolean; message: string }> {
    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < amount) return { success: false, message: 'Solde insuffisant' };

      await this.prisma.$transaction([
        this.prisma.transaction.create({ data: { userId, type: 'WITHDRAWAL', amount: -amount, status: 'PENDING' } }),
        this.prisma.wallet.update({ where: { userId }, data: { balance: { decrement: amount } } }),
      ]);

      return { success: true, message: 'Demande de retrait envoyée' };
    } catch (error) {
      this.logger.error('Erreur retrait:', error);
      return { success: false, message: 'Erreur lors du retrait' };
    }
  }

  async getTransactionHistory(userId: string) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ✅ FIX V1: Stripe intent avec userId bien propagé en mode mock
  async createRechargeIntent(userId: string, amount: number): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // Mode dev: mock avec userId intégré dans la référence
      const mockId = `pi_mock_${userId}_${Date.now()}`;
      return { clientSecret: `${mockId}_secret_mock`, paymentIntentId: mockId };
    }
    try {
      const stripe = require('stripe')(stripeKey);
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'eur',
        metadata: { userId },
      });
      return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
    } catch (e) {
      throw new Error(`Stripe error: ${(e as any).message}`);
    }
  }

  // ✅ FIX V1: confirmRechargeIntent — userId toujours résolu, jamais vide en mock
  async confirmRechargeIntent(paymentIntentId: string, userId?: string): Promise<{ success: boolean; balance: number }> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    let amount = 0;
    let resolvedUserId = userId ?? '';

    if (stripeKey && !paymentIntentId.startsWith('pi_mock_')) {
      try {
        const stripe = require('stripe')(stripeKey);
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.status !== 'succeeded') throw new Error('Paiement non confirmé');
        amount = intent.amount / 100;
        resolvedUserId = intent.metadata?.userId ?? resolvedUserId;
      } catch (e) {
        throw new Error(`Stripe confirm error: ${(e as any).message}`);
      }
    } else {
      // Mode mock — extraire userId du mockId
      const parts = paymentIntentId.split('_');
      if (parts.length >= 3 && !resolvedUserId) resolvedUserId = parts[2];
      amount = 10;
    }

    if (!resolvedUserId) {
      this.logger.warn('confirmRechargeIntent: userId introuvable, recharge ignorée');
      return { success: false, balance: 0 };
    }

    const wallet = await this.prisma.wallet.update({
      where: { userId: resolvedUserId },
      data: { balance: { increment: amount } },
    });
  await this.prisma.transaction.create({
  data: { 
    userId: resolvedUserId, 
    type: 'RECHARGE', 
    amount, 
    status: 'COMPLETED', 
    externalRef: paymentIntentId,   // ← Utilise externalRef au lieu de stripePaymentId
  },
});
    return { success: true, balance: wallet.balance };
  }

  // ── GESTION DES CARTES ─────────────────────────────────────────────────────
  async saveCard(userId: string, stripeMethodId: string) {
    try {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) throw new Error('Stripe not configured');
      const stripe = require('stripe')(stripeKey);

      // 1. Récupérer les détails de la carte via Stripe
      const method = await stripe.paymentMethods.retrieve(stripeMethodId);
      const card = method.card;

      // 2. Enregistrer dans la DB
      const savedCard = await this.prisma.savedCard.create({
        data: {
          userId,
          stripeMethodId,
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
          isDefault: true, // Par défaut la nouvelle carte devient la principale
        },
      });

      // 3. Envoyer l'email
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.email) {
        await this.mailService.sendCardRegistered(user.email, card.brand, card.last4, user.language);
      }

      return savedCard;
    } catch (e) {
      this.logger.error('Error saving card:', e);
      throw e;
    }
  }

  async listCards(userId: string) {
    return this.prisma.savedCard.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCard(userId: string, cardId: string) {
    return this.prisma.savedCard.delete({
      where: { id: cardId, userId },
    });
  }
}
