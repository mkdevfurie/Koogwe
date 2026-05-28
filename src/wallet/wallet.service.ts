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
    if (paymentIntentId?.startsWith('pi_mock_') || paymentIntentId?.startsWith('seti_mock_')) {
      throw new BadRequestException('Intent de paiement mock interdit en production');
    }
  }

  private getStripe(): any | null {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return null;
    return require('stripe')(stripeKey);
  }

  getStripeConfig(): { enabled: boolean; publishableKey: string | null; mode: 'test' | 'live' } {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim() || null;
    const hasSecret = !!process.env.STRIPE_SECRET_KEY?.trim();
    return {
      enabled: hasSecret && !!publishableKey,
      publishableKey,
      mode: this.isProduction() ? 'live' : 'test',
    };
  }

  async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, stripeCustomerId: true },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const stripe = this.getStripe();
    if (!stripe) throw new BadRequestException('Stripe non configuré');

    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  async createSetupIntent(userId: string): Promise<{
    clientSecret: string;
    setupIntentId: string;
    mock: boolean;
  }> {
    this.assertStripeConfigured();
    const stripe = this.getStripe();

    if (!stripe) {
      if (this.isProduction()) {
        throw new BadRequestException('Stripe non configuré');
      }
      const mockId = `seti_mock_${userId}_${Date.now()}`;
      return {
        clientSecret: `${mockId}_secret_mock`,
        setupIntentId: mockId,
        mock: true,
      };
    }

    const customerId = await this.getOrCreateStripeCustomer(userId);
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { userId },
    });

    return {
      clientSecret: intent.client_secret as string,
      setupIntentId: intent.id,
      mock: false,
    };
  }

  async confirmCardFromSetupIntent(userId: string, setupIntentId: string) {
    this.assertNotMockPayment(undefined, setupIntentId);

    if (setupIntentId.startsWith('seti_mock_')) {
      if (this.isProduction()) {
        throw new BadRequestException('Mock interdit en production');
      }
      return this.saveDevMockCard(userId, `pm_mock_${userId}_${Date.now()}`);
    }

    const stripe = this.getStripe();
    if (!stripe) throw new BadRequestException('Stripe non configuré');

    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    if (intent.metadata?.userId && intent.metadata.userId !== userId) {
      throw new ForbiddenException('SetupIntent invalide pour cet utilisateur');
    }
    if (intent.status !== 'succeeded') {
      throw new BadRequestException('Enregistrement carte non confirmé');
    }

    const pmId =
      typeof intent.payment_method === 'string'
        ? intent.payment_method
        : intent.payment_method?.id;
    if (!pmId) throw new BadRequestException('Aucune carte associée');

    return this.saveCard(userId, pmId);
  }

  private async saveDevMockCard(userId: string, stripeMethodId: string) {
    const brand = stripeMethodId.includes('master') ? 'mastercard' : 'visa';
    await this.prisma.savedCard.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    return this.prisma.savedCard.create({
      data: {
        userId,
        stripeMethodId,
        brand,
        last4: '4242',
        expMonth: 12,
        expYear: new Date().getFullYear() + 3,
        isDefault: true,
      },
    });
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
        metadata: { userId, purpose: 'wallet_recharge' },
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

    const alreadyCredited = await this.prisma.transaction.findFirst({
      where: {
        userId: resolvedUserId,
        type: 'RECHARGE',
        status: 'COMPLETED',
        externalRef: paymentIntentId,
      },
      select: { id: true },
    });
    if (alreadyCredited) {
      const existingWallet = await this.prisma.wallet.findUnique({
        where: { userId: resolvedUserId },
      });
      return { success: true, balance: existingWallet?.balance ?? 0 };
    }

    const [wallet] = await this.prisma.$transaction([
      this.prisma.wallet.upsert({
        where: { userId: resolvedUserId },
        create: { userId: resolvedUserId, balance: amount },
        update: { balance: { increment: amount } },
      }),
      this.prisma.transaction.create({
        data: {
          userId: resolvedUserId,
          type: 'RECHARGE',
          amount,
          status: 'COMPLETED',
          externalRef: paymentIntentId,
        },
      }),
    ]);

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
      const stripe = this.getStripe();

      if (!stripe) {
        if (this.isProduction()) {
          throw new BadRequestException('Stripe non configuré');
        }
        return this.saveDevMockCard(userId, stripeMethodId);
      }

      const customerId = await this.getOrCreateStripeCustomer(userId);
      const method = await stripe.paymentMethods.retrieve(stripeMethodId);
      const card = method.card;
      if (!card) throw new BadRequestException('Méthode de paiement invalide');

      try {
        await stripe.paymentMethods.attach(stripeMethodId, { customer: customerId });
      } catch (attachErr: any) {
        if (!attachErr?.message?.includes('already been attached')) {
          throw attachErr;
        }
      }

      await this.prisma.savedCard.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });

      const savedCard = await this.prisma.savedCard.create({
        data: {
          userId,
          stripeMethodId,
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
          isDefault: true,
        },
      });

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.email) {
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

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeKey || !webhookSecret) {
      throw new BadRequestException('Webhook Stripe non configuré');
    }

    const stripe = require('stripe')(stripeKey);
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const userId = intent.metadata?.userId as string | undefined;
      const purpose = intent.metadata?.purpose as string | undefined;

      if (purpose === 'wallet_recharge' && userId) {
        const ref = `stripe_evt_${event.id}`;
        const existing = await this.prisma.transaction.findFirst({
          where: { reference: ref },
        });
        if (existing) return;

        const amount = intent.amount / 100;
        await this.prisma.$transaction([
          this.prisma.wallet.upsert({
            where: { userId },
            create: { userId, balance: amount },
            update: { balance: { increment: amount } },
          }),
          this.prisma.transaction.create({
            data: {
              userId,
              type: 'RECHARGE',
              amount,
              status: 'COMPLETED',
              paymentMethod: 'CARD',
              reference: ref,
              externalRef: intent.id,
            },
          }),
        ]);
      }
    }
  }

  async transferTip(
    passengerId: string,
    driverId: string,
    rideId: string,
    amount: number,
  ): Promise<{ success: boolean; message: string }> {
    if (amount <= 0 || amount > 200) {
      return { success: false, message: 'Montant de pourboire invalide' };
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: passengerId } });
    if (!wallet || wallet.balance < amount) {
      return { success: false, message: 'Solde insuffisant pour le pourboire' };
    }

    const share = amount;
    const ref = `tip_${rideId}_${Date.now()}`;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId: passengerId },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.wallet.upsert({
        where: { userId: driverId },
        create: { userId: driverId, balance: share },
        update: { balance: { increment: share } },
      }),
      this.prisma.transaction.create({
        data: {
          userId: passengerId,
          type: 'PAYMENT',
          amount: -amount,
          status: 'COMPLETED',
          rideId,
          paymentMethod: 'WALLET',
          reference: ref,
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId: driverId,
          type: 'RECHARGE',
          amount: share,
          status: 'COMPLETED',
          rideId,
          paymentMethod: 'WALLET',
          reference: ref,
        },
      }),
      this.prisma.ride.update({
        where: { id: rideId },
        data: { tipAmount: amount },
      }),
    ]);

    return { success: true, message: 'Pourboire envoyé' };
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.savedCard.findFirst({
      where: { id: cardId, userId },
    });
    if (!card) throw new BadRequestException('Carte introuvable');

    const stripe = this.getStripe();
    if (stripe && card.stripeMethodId && !card.stripeMethodId.startsWith('pm_mock_')) {
      try {
        await stripe.paymentMethods.detach(card.stripeMethodId);
      } catch (e) {
        this.logger.warn(`Stripe detach failed for ${card.stripeMethodId}: ${(e as Error).message}`);
      }
    }

    return this.prisma.savedCard.delete({
      where: { id: cardId, userId },
    });
  }
}
