import { Injectable } from '@nestjs/common';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import {
  EmailTemplateKey,
  defaultEmailTemplates,
  interpolateTemplate,
  stripEmojis,
  wrapEmailHtml,
} from './email-templates.defaults';

@Injectable()
export class MailTemplateService {
  constructor(private readonly platformConfig: PlatformConfigService) {}

  async render(
    key: EmailTemplateKey,
    language: string,
    vars: Record<string, string>,
  ): Promise<{ subject: string; html: string } | null> {
    const [templates, platform] = await Promise.all([
      this.platformConfig.getEmailTemplates(),
      this.platformConfig.getPlatform(),
    ]);

    const tpl = templates[key] ?? defaultEmailTemplates()[key];
    if (!tpl?.enabled) return null;

    const enriched = {
      appName: platform.appName,
      supportEmail: platform.supportEmail,
      ...vars,
    };

    const isEn = language === 'en';
    let subject = interpolateTemplate(isEn ? tpl.subjectEn : tpl.subjectFr, enriched);
    let body = interpolateTemplate(isEn ? tpl.bodyEn : tpl.bodyFr, enriched);

    if (!tpl.useEmojis) {
      subject = stripEmojis(subject);
      body = stripEmojis(body);
    }

    const html = wrapEmailHtml(body, platform.appName, tpl.useEmojis);
    return { subject, html };
  }

  async preview(
    key: EmailTemplateKey,
    language: string,
    patch?: Partial<{ subjectFr: string; subjectEn: string; bodyFr: string; bodyEn: string; useEmojis: boolean }>,
  ) {
    const templates = await this.platformConfig.getEmailTemplates();
    const platform = await this.platformConfig.getPlatform();
    const base = { ...templates[key], ...patch };
    const sampleVars: Record<string, string> = {
      code: '482916',
      firstName: 'Marie',
      appName: platform.appName,
      supportEmail: platform.supportEmail,
      amount: '12.50',
      rideId: 'A1B2C3',
      driverName: 'Jean Dupont',
      reason: 'Documents incomplets',
      brand: 'Visa',
      last4: '4242',
    };

    const isEn = language === 'en';
    let subject = interpolateTemplate(isEn ? base.subjectEn : base.subjectFr, sampleVars);
    let body = interpolateTemplate(isEn ? base.bodyEn : base.bodyFr, sampleVars);
    const useEmojis = base.useEmojis ?? true;
    if (!useEmojis) {
      subject = stripEmojis(subject);
      body = stripEmojis(body);
    }
    return { subject, html: wrapEmailHtml(body, platform.appName, useEmojis) };
  }
}
