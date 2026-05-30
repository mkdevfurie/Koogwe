// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { MailTemplateService } from './mail-template.service';
import { EmailTemplateKey } from './email-templates.defaults';
import {
  defaultEmailTemplates,
  interpolateTemplate,
  stripEmojis,
  wrapEmailHtml,
} from './email-templates.defaults';

@Injectable()
export class MailService {
  private resend: Resend;
  private logger = new Logger('MailService');

  constructor(private readonly templates: MailTemplateService) {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  private async sendFromTemplate(
    key: EmailTemplateKey,
    to: string,
    language: string,
    vars: Record<string, string>,
    fallback: { subject: string; html: string },
  ) {
    const rendered = await this.templates.render(key, language, vars);
    if (rendered) {
      await this.sendEmail(to, rendered.subject, rendered.html);
      return;
    }
    await this.sendEmail(to, fallback.subject, fallback.html);
  }

  async sendOtp(email: string, code: string, language = 'fr') {
    const tpl = defaultEmailTemplates().otp;
    const subject = interpolateTemplate(language === 'fr' ? tpl.subjectFr : tpl.subjectEn, {
      code,
      appName: 'Koogwe',
    });
    const body = interpolateTemplate(language === 'fr' ? tpl.bodyFr : tpl.bodyEn, {
      code,
      appName: 'Koogwe',
    });
    await this.sendFromTemplate('otp', email, language, { code }, {
      subject,
      html: wrapEmailHtml(body, 'Koogwe', true),
    });
    this.logger.log(`OTP envoyé à ${email}`);
  }

  async sendWelcome(email: string, firstName: string, language = 'fr') {
    await this.sendFromTemplate('welcome', email, language, { firstName }, {
      subject: language === 'fr' ? 'Bienvenue sur Koogwe' : 'Welcome to Koogwe',
      html: wrapEmailHtml(
        `<p>Bienvenue ${firstName} !</p><p>Votre compte a été créé avec succès.</p>`,
        'Koogwe',
        true,
      ),
    });
  }

  async sendRideConfirmation(email: string, rideDetails: Record<string, unknown>, language = 'fr') {
    const firstName = String(rideDetails.firstName ?? rideDetails.passengerName ?? '');
    await this.sendFromTemplate('ride_confirmation', email, language, {
      firstName,
      rideId: String(rideDetails.id ?? rideDetails.rideId ?? '—'),
      driverName: String(rideDetails.driverName ?? '—'),
      amount: String(rideDetails.price ?? rideDetails.estimatedPrice ?? rideDetails.amount ?? '—'),
    }, {
      subject: language === 'fr' ? 'Confirmation de course Koogwe' : 'Koogwe Ride Confirmation',
      html: wrapEmailHtml(`<p>Course confirmée</p><pre>${JSON.stringify(rideDetails)}</pre>`, 'Koogwe', false),
    });
  }

  async sendDriverApproved(email: string, firstName: string, language = 'fr') {
    await this.sendFromTemplate('driver_approved', email, language, { firstName }, {
      subject: language === 'fr' ? 'Compte chauffeur approuvé' : 'Driver account approved',
      html: wrapEmailHtml(`<p>Félicitations ${firstName} !</p>`, 'Koogwe', true),
    });
    this.logger.log(`Email approbation envoyé à ${email}`);
  }

  async sendDriverRejected(email: string, firstName: string, reason?: string, language = 'fr') {
    await this.sendFromTemplate('driver_rejected', email, language, {
      firstName,
      reason: reason ?? (language === 'fr' ? 'Non précisée' : 'Not specified'),
    }, {
      subject: language === 'fr' ? 'Compte chauffeur refusé' : 'Driver account rejected',
      html: wrapEmailHtml(`<p>Bonjour ${firstName},</p><p>Motif : ${reason ?? '—'}</p>`, 'Koogwe', false),
    });
    this.logger.log(`Email refus envoyé à ${email}`);
  }

  async sendDriverValidation(email: string, approved: boolean, language = 'fr') {
    if (approved) {
      await this.sendDriverApproved(email, 'Chauffeur', language);
    } else {
      await this.sendDriverRejected(email, 'Chauffeur', undefined, language);
    }
  }

  async sendPaymentConfirmation(email: string, amount: number, language = 'fr', firstName = '') {
    await this.sendFromTemplate('payment_confirmation', email, language, {
      firstName,
      amount: String(amount),
    }, {
      subject: 'Confirmation de paiement',
      html: wrapEmailHtml(`<h1>Paiement de ${amount} € confirmé</h1>`, 'Koogwe', true),
    });
  }

  async sendCardRegistered(email: string, brand: string, last4: string, language = 'fr', firstName = '') {
    await this.sendFromTemplate('card_registered', email, language, {
      firstName,
      brand,
      last4,
    }, {
      subject: language === 'fr' ? 'Nouvelle carte enregistrée' : 'New payment method added',
      html: wrapEmailHtml(
        `<p>Carte ${brand} •••• ${last4} enregistrée.</p>`,
        'Koogwe',
        true,
      ),
    });
  }

  /** Envoi test depuis l'admin */
  async sendTestEmail(to: string, subject: string, html: string) {
    await this.sendEmail(to, `[TEST] ${subject}`, html);
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
      if (subject.toLowerCase().includes('code') || subject.toLowerCase().includes('otp')) {
        throw error;
      }
    }
  }
}
