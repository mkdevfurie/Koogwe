// src/mail/mail.service.ts (version Resend)
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;
  private logger = new Logger('MailService');

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendOtp(email: string, code: string, language = 'fr') {
    const subject = language === 'fr' ? 'Votre code Koogwe' : 'Your Koogwe verification code';
    const html = `
      <h1>${code}</h1>
      <p>Ce code expire dans 10 minutes.</p>
    `;
    await this.sendEmail(email, subject, html);
    this.logger.log(`OTP envoyé à ${email}`);
  }

  async sendWelcome(email: string, firstName: string, language = 'fr') {
    const subject = language === 'fr' ? 'Bienvenue sur Koogwe' : 'Welcome to Koogwe';
    const html = `
      <h1>Bienvenue ${firstName} !</h1>
      <p>Votre compte a été créé avec succès.</p>
    `;
    await this.sendEmail(email, subject, html);
  }

  async sendRideConfirmation(email: string, rideDetails: any, language = 'fr') {
    const subject = language === 'fr' ? 'Confirmation de course Koogwe' : 'Koogwe Ride Confirmation';
    const html = `
      <h1>Course confirmée</h1>
      <p>Détails: ${JSON.stringify(rideDetails)}</p>
    `;
    await this.sendEmail(email, subject, html);
  }

  async sendDriverApproved(email: string, firstName: string, language = 'fr') {
    const subject = language === 'fr' ? 'Compte chauffeur approuvé ✅' : 'Driver account approved ✅';
    const html = `
      <h1>Félicitations ${firstName} !</h1>
      <p>Votre compte chauffeur a été approuvé. Vous pouvez maintenant vous connecter et accepter des courses.</p>
    `;
    await this.sendEmail(email, subject, html);
    this.logger.log(`Email approbation envoyé à ${email}`);
  }

  async sendDriverRejected(email: string, firstName: string, reason?: string, language = 'fr') {
    const subject = language === 'fr' ? 'Compte chauffeur refusé ❌' : 'Driver account rejected ❌';
    const html = `
      <h1>Bonjour ${firstName},</h1>
      <p>Votre demande de compte chauffeur a été refusée pour la raison suivante :</p>
      <blockquote>${reason ?? 'Non précisée'}</blockquote>
      <p>Veuillez contacter le support pour plus d'informations.</p>
    `;
    await this.sendEmail(email, subject, html);
    this.logger.log(`Email refus envoyé à ${email}`);
  }

  async sendDriverValidation(email: string, approved: boolean, language = 'fr') {
    const subject = approved ? 'Compte chauffeur validé' : 'Compte chauffeur refusé';
    const html = approved ? '<h1>Votre compte est validé !</h1>' : '<h1>Votre compte a été refusé.</h1>';
    await this.sendEmail(email, subject, html);
  }

  async sendPaymentConfirmation(email: string, amount: number, language = 'fr') {
    const subject = 'Confirmation de paiement';
    const html = `<h1>Paiement de ${amount} € confirmé</h1>`;
    await this.sendEmail(email, subject, html);
  }

  async sendCardRegistered(email: string, brand: string, last4: string, language = 'fr') {
    const subject = language === 'fr' ? 'Nouvelle carte enregistrée' : 'New payment method added';
    const html = `
      <h1>Carte enregistrée avec succès</h1>
      <p>Une nouvelle carte <strong>${brand}</strong> se terminant par <strong>${last4}</strong> a été ajoutée à votre compte Koogwe.</p>
      <p>Si vous n'êtes pas à l'origine de cette action, veuillez contacter le support immédiatement.</p>
    `;
    await this.sendEmail(email, subject, html);
  }

  private async sendEmail(to: string, subject: string, html: string) {
    const from =
      process.env.RESEND_FROM || 'Koogwe <noreply@inovtechno.org>';
    const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? 10_000);

    try {
      await Promise.race([
        this.resend.emails.send({ from, to, subject, html }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Resend timeout après ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (error) {
      this.logger.error(`Erreur envoi email à ${to} [Sujet: ${subject}]: ${error.message}`);
      // On ne rebalance pas l'erreur pour éviter de casser le flux principal (ex: création de course)
      // sauf si c'est critique (ex: envoi OTP)
      if (subject.includes('code') || subject.includes('OTP')) {
        throw error;
      }
    }
  }
}