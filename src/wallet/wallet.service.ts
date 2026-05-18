// src/wallet/wallet.service.ts
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { Ride } from '@prisma/client';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private driverShare(amount: number): number {
    const rate = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.2);
    return amount * (1 - rate);
  }

  private assertStripeConfigured(): void {
    if (this.isProduction() && !process.env.STRIPE_SECRET_KEY) {
      throw new BadRequestException('Paiements Stripe non configurés en production');
    }
  }

  private assertNotMockPayment(stripeMethodId?: string, paymentIntentId?: string): void {
    if (!this.isProduction()) return;
    if (stripeMethodId?.startsWith('pm_mock_')) {
      throw new BadRequestException('Méthode de paiement mock interdite en production');
    }
    if (paymentIntentId?.startsWith('pi_mock_')) {
      throw new BadRequestException('Intent de paiement mock interdit en production');
    }
  }

  /**
   * Montant facturable côté serveur pour une course.
   * @param requireParticipant si true, l'utilisateur doit être passager ou chauffeur de la course
   */
  async resolveChargeAmount(
    rideId: string,
    userId: string,
    options?: {
      requireParticipant?: boolean;
      allowUnpaidOnly?: boolean;
      allowDriverPreAccept?: boolean;
    },
  ): Promise<{ ride: Ride; amount: number }> {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new BadRequestException('Course introuvable');

    let isAuthorized =
      ride.passengerId === userId || ride.driverId === userId;

    if (!isAuthorized && options?.allowDriverPreAccept && ride.status === 'REQUESTED') {
      const driverProfile = await this.prisma.driverProfile.findUnique({
        where: { userId },
        select: { adminApproved: true },
      });
      isAuthorized = !!driverProfile?.adminApproved;
    }

    if (options?.requireParticipant !== false && !isAuthorized) {
      throw new ForbiddenException('Non autorisé pour cette course');
    }

    if (options?.allowUnpaidOnly !== false && ride.isPaid) {
      throw new BadRequestException('Cette course est déjà payée');
    }

    const amount = ride.finalPrice ?? ride.estimatedPrice;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Montant de course invalide');
    }

    return { ride, amount };
  }

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

  async payRideFromWallet(userId: string, rideId: string, amount?: number): Promise<{ success: boolean; message: string }> {
    try {
      const { ride, amount: resolved } = await this.resolveChargeAmount(rideId, userId);
      if (ride.passengerId !== userId) {
        return { success: false, message: 'Seul le passager peut payer depuis le wallet' };
      }
      if (amount != null && Math.abs(amount - resolved) > 0.01) {
        return { success: false, message: 'Montant invalide' };
      }
      amount = resolved;

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < amount) return { success: false, message: 'Solde insuffisant' };

      if (!ride.driverId) return { success: false, message: 'Course introuvable' };

      const share = this.driverShare(amount);
      await this.prisma.$transaction([
        this.prisma.wallet.update({ where: { userId }, data: { balance: { decrement: amount } } }),
        this.prisma.wallet.update({ where: { userId: ride.driverId }, data: { balance: { increment: share } } }),
        this.prisma.transaction.create({ data: { userId, type: 'PAYMENT', amount: -amount, status: 'COMPLETED', rideId, paymentMethod: 'WALLET' } }),
        this.prisma.transaction.create({ data: { userId: ride.driverId, type: 'RECHARGE', amount: share, status: 'COMPLETED', rideId, paymentMethod: 'WALLET' } }),
        this.prisma.ride.update({ where: { id: rideId }, data: { isPaid: true } }),
      ]);

      return { success: true, message: 'Paiement réussi' };
    } catch (error) {
      this.logger.error('Erreur paiement wallet:', error);
      return { success: false, message: 'Erreur lors du paiement' };
    }
  }

  async payRideFromCard(userId: string, rideId: string, amount?: number): Promise<{ success: boolean; message: string }> {
    try {
      const { ride, amount: resolved } = await this.resolveChargeAmount(rideId, userId);
      if (ride.passengerId !== userId) {
        return { success: false, message: 'Seul le passager peut payer par carte' };
      }
      if (amount != null && Math.abs(amount - resolved) > 0.01) {
        return { success: false, message: 'Montant invalide' };
      }
      amount = resolved;

      if (!ride.driverId) return { success: false, message: 'Course introuvable' };

      const card = await this.prisma.savedCard.findFirst({ where: { userId } });
      if (!card) return { success: false, message: 'Aucune carte bancaire enregistrée' };

      this.assertNotMockPayment(card.stripeMethodId);

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      let transactionRef = `pi_card_${Date.now()}`;

      if (stripeKey) {
        try {
          const stripe = require('stripe')(stripeKey);
          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'eur',
            payment_method: card.stripeMethodId,
            confirm: true,
            off_session: true,
            metadata: { rideId, userId },
          });
          if (paymentIntent.status !== 'succeeded') {
            return { success: false, message: `Paiement Stripe échoué : ${paymentIntent.status}` };
          }
          transactionRef = paymentIntent.id;
        } catch (e) {
          this.logger.error(`Stripe payment failed for ride ${rideId}: ${(e as any).message}`, (e as any).stack);
          return { success: false, message: `Erreur Stripe : ${(e as any).message}` };
        }
      } else if (this.isProduction()) {
        return { success: false, message: 'Stripe non configuré' };
      }

      const share = this.driverShare(amount);
      await this.prisma.$transaction([
        this.prisma.wallet.update({ where: { userId: ride.driverId }, data: { balance: { increment: share } } }),
        this.prisma.transaction.create({ data: { userId, type: 'PAYMENT', amount: -amount, status: 'COMPLETED', rideId, paymentMethod: 'CARD', reference: transactionRef } }),
        this.prisma.transaction.create({ data: { userId: ride.driverId, type: 'RECHARGE', amount: share, status: 'COMPLETED', rideId, paymentMethod: 'CARD', reference: transactionRef } }),
        this.prisma.ride.update({ where: { id: rideId }, data: { isPaid: true } }),
      ]);

      return { success: true, message: 'Paiement par carte réussi et commission reversée' };
    } catch (error) {
      this.logger.error('Erreur paiement carte:', error);
      return { success: false, message: 'Erreur lors du paiement par carte' };
    }
  }

  async payRideFromPaypal(userId: string, rideId: string, amount?: number): Promise<{ success: boolean; message: string }> {
    try {
      const { ride, amount: resolved } = await this.resolveChargeAmount(rideId, userId);
      if (ride.passengerId !== userId) {
        return { success: false, message: 'Seul le passager peut payer via PayPal' };
      }
      if (amount != null && Math.abs(amount - resolved) > 0.01) {
        return { success: false, message: 'Montant invalide' };
      }
      amount = resolved;

      if (!ride.driverId) return { success: false, message: 'Course introuvable' };

      const transactionRef = `paypal_${Date.now()}`;
      const share = this.driverShare(amount);

      await this.prisma.$transaction([
        this.prisma.wallet.update({ where: { userId: ride.driverId }, data: { balance: { increment: share } } }),
        this.prisma.transaction.create({ data: { userId, type: 'PAYMENT', amount: -amount, status: 'COMPLETED', rideId, paymentMethod: 'CARD', reference: transactionRef, externalRef: 'PayPal Payment' } }),
        this.prisma.transaction.create({ data: { userId: ride.driverId, type: 'RECHARGE', amount: share, status: 'COMPLETED', rideId, paymentMethod: 'CARD', reference: transactionRef, externalRef: 'PayPal Payment' } }),
        this.prisma.ride.update({ where: { id: rideId }, data: { isPaid: true } }),
      ]);

      return { success: true, message: 'Paiement PayPal enregistré avec succès et commission reversée' };
    } catch (error) {
      this.logger.error('Erreur paiement PayPal:', error);
      return { success: false, message: 'Erreur lors du paiement PayPal' };
    }
  }

  async recordCashPayment(userId: string, rideId: string, amount?: number): Promise<{ success: boolean; message: string }> {
    try {
      const { ride, amount: resolved } = await this.resolveChargeAmount(rideId, userId);
      if (ride.passengerId !== userId && ride.driverId !== userId) {
        return { success: false, message: 'Course introuvable ou non autorisée' };
      }
      if (amount != null && Math.abs(amount - resolved) > 0.01) {
        return { success: false, message: 'Montant invalide' };
      }
      amount = resolved;

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
    this.assertStripeConfigured();
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
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
      this.logger.error(`Stripe error creating intent: ${(e as any).message}`, (e as any).stack);
      throw new Error(`Stripe error: ${(e as any).message}`);
    }
  }

  // ✅ FIX V1: confirmRechargeIntent — userId toujours résolu, jamais vide en mock
  async confirmRechargeIntent(paymentIntentId: string, userId?: string): Promise<{ success: boolean; balance: number }> {
    this.assertNotMockPayment(undefined, paymentIntentId);
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
        this.logger.error(`Stripe confirm error for intent ${paymentIntentId}: ${(e as any).message}`, (e as any).stack);
        throw new Error(`Stripe confirm error: ${(e as any).message}`);
      }
    } else {
      if (this.isProduction()) {
        throw new BadRequestException('Paiement mock interdit en production');
      }
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
  async authorizeRidePayment(
    userId: string,
    rideId: string,
    paymentMethod?: string,
  ): Promise<{ success: boolean; message: string; status: string; transactionId: string; clientSecret?: string }> {
    const { ride, amount } = await this.resolveChargeAmount(rideId, userId, {
      allowUnpaidOnly: true,
      allowDriverPreAccept: true,
    });

    const method = (paymentMethod || ride.paymentMethod || 'CASH').toUpperCase();
    if (method === 'CASH') {
      return {
        success: true,
        message: 'Paiement espèces — autorisation non requise',
        status: 'AUTHORIZED',
        transactionId: `cash_${rideId}`,
      };
    }

    this.assertStripeConfigured();
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      if (this.isProduction()) {
        throw new BadRequestException('Stripe non configuré');
      }
      return {
        success: true,
        message: 'Paiement autorisé (mode dev)',
        status: 'AUTHORIZED',
        transactionId: `auth_dev_${Date.now()}`,
      };
    }

    const stripe = require('stripe')(stripeKey);
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      capture_method: 'manual',
      metadata: { rideId, userId, passengerId: ride.passengerId },
    });

    return {
      success: true,
      message: 'Paiement autorisé',
      status: 'AUTHORIZED',
      transactionId: intent.id,
      clientSecret: intent.client_secret,
    };
  }

  async saveCard(userId: string, stripeMethodId: string) {
    try {
      this.assertNotMockPayment(stripeMethodId);
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
