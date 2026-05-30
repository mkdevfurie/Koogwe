export type EmailTemplateKey =
  | 'otp'
  | 'welcome'
  | 'ride_confirmation'
  | 'driver_approved'
  | 'driver_rejected'
  | 'payment_confirmation'
  | 'card_registered';

export type EmailTemplate = {
  label: string;
  enabled: boolean;
  useEmojis: boolean;
  subjectFr: string;
  subjectEn: string;
  bodyFr: string;
  bodyEn: string;
  variables: string[];
};

export type EmailTemplatesConfig = Record<EmailTemplateKey, EmailTemplate>;

export function defaultEmailTemplates(): EmailTemplatesConfig {
  return {
    otp: {
      label: 'Code de validation (OTP)',
      enabled: true,
      useEmojis: true,
      subjectFr: '{{appName}} — Votre code : {{code}}',
      subjectEn: '{{appName}} — Your code: {{code}}',
      bodyFr: `
        <p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Bonjour,</p>
        <p style="margin:0 0 16px;color:#334155;">Voici votre code de connexion {{appName}} :</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;font-size:32px;font-weight:800;letter-spacing:8px;color:#2B5FF5;background:#EFF6FF;padding:16px 28px;border-radius:12px;">{{code}}</span>
        </div>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px;">⏱️ Ce code expire dans 10 minutes.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Hello,</p>
        <p style="margin:0 0 16px;color:#334155;">Here is your {{appName}} login code:</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;font-size:32px;font-weight:800;letter-spacing:8px;color:#2B5FF5;background:#EFF6FF;padding:16px 28px;border-radius:12px;">{{code}}</span>
        </div>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px;">⏱️ This code expires in 10 minutes.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">If you did not request this code, you can ignore this email.</p>
      `.trim(),
      variables: ['code', 'appName', 'supportEmail'],
    },
    welcome: {
      label: 'Bienvenue',
      enabled: true,
      useEmojis: true,
      subjectFr: 'Bienvenue sur {{appName}} 🎉',
      subjectEn: 'Welcome to {{appName}} 🎉',
      bodyFr: `
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;">Bonjour {{firstName}} 👋</p>
        <p style="margin:0 0 16px;color:#334155;">Votre compte {{appName}} a été créé avec succès.</p>
        <p style="margin:0 0 16px;color:#334155;">Vous pouvez dès maintenant réserver vos courses en toute simplicité.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Besoin d'aide ? Contactez-nous : {{supportEmail}}</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;">Hello {{firstName}} 👋</p>
        <p style="margin:0 0 16px;color:#334155;">Your {{appName}} account has been created successfully.</p>
        <p style="margin:0 0 16px;color:#334155;">You can now book rides with ease.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Need help? Contact us: {{supportEmail}}</p>
      `.trim(),
      variables: ['firstName', 'appName', 'supportEmail'],
    },
    ride_confirmation: {
      label: 'Confirmation de course',
      enabled: true,
      useEmojis: true,
      subjectFr: 'Course confirmée — {{appName}}',
      subjectEn: 'Ride confirmed — {{appName}}',
      bodyFr: `
        <p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Bonjour {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Votre course {{appName}} est confirmée 🚗</p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#334155;">
          <li>Course : #{{rideId}}</li>
          <li>Chauffeur : {{driverName}}</li>
          <li>Montant : {{amount}} €</li>
        </ul>
        <p style="margin:0;color:#64748b;font-size:14px;">Bonne route !</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Hello {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Your {{appName}} ride is confirmed 🚗</p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#334155;">
          <li>Ride: #{{rideId}}</li>
          <li>Driver: {{driverName}}</li>
          <li>Amount: {{amount}} €</li>
        </ul>
        <p style="margin:0;color:#64748b;font-size:14px;">Have a safe trip!</p>
      `.trim(),
      variables: ['firstName', 'rideId', 'driverName', 'amount', 'appName'],
    },
    driver_approved: {
      label: 'Chauffeur approuvé',
      enabled: true,
      useEmojis: true,
      subjectFr: 'Compte chauffeur approuvé ✅ — {{appName}}',
      subjectEn: 'Driver account approved ✅ — {{appName}}',
      bodyFr: `
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;">Félicitations {{firstName}} 🎉</p>
        <p style="margin:0 0 16px;color:#334155;">Votre compte chauffeur {{appName}} a été approuvé.</p>
        <p style="margin:0;color:#334155;">Connectez-vous à l'application chauffeur pour passer en ligne et recevoir des courses.</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;">Congratulations {{firstName}} 🎉</p>
        <p style="margin:0 0 16px;color:#334155;">Your {{appName}} driver account has been approved.</p>
        <p style="margin:0;color:#334155;">Log in to the driver app to go online and accept rides.</p>
      `.trim(),
      variables: ['firstName', 'appName', 'supportEmail'],
    },
    driver_rejected: {
      label: 'Chauffeur refusé',
      enabled: true,
      useEmojis: false,
      subjectFr: 'Demande chauffeur refusée — {{appName}}',
      subjectEn: 'Driver application rejected — {{appName}}',
      bodyFr: `
        <p style="margin:0 0 16px;color:#0f172a;">Bonjour {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Votre demande de compte chauffeur {{appName}} n'a pas été acceptée.</p>
        <p style="margin:0 0 8px;color:#334155;"><strong>Motif :</strong> {{reason}}</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Pour plus d'informations : {{supportEmail}}</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;color:#0f172a;">Hello {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Your {{appName}} driver application was not approved.</p>
        <p style="margin:0 0 8px;color:#334155;"><strong>Reason:</strong> {{reason}}</p>
        <p style="margin:0;color:#64748b;font-size:14px;">For more information: {{supportEmail}}</p>
      `.trim(),
      variables: ['firstName', 'reason', 'appName', 'supportEmail'],
    },
    payment_confirmation: {
      label: 'Confirmation paiement',
      enabled: true,
      useEmojis: true,
      subjectFr: 'Paiement confirmé — {{amount}} €',
      subjectEn: 'Payment confirmed — {{amount}} €',
      bodyFr: `
        <p style="margin:0 0 16px;color:#0f172a;">Bonjour {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Votre paiement de <strong>{{amount}} €</strong> a bien été enregistré 💳</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Merci d'utiliser {{appName}}.</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;color:#0f172a;">Hello {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Your payment of <strong>{{amount}} €</strong> has been confirmed 💳</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Thank you for using {{appName}}.</p>
      `.trim(),
      variables: ['firstName', 'amount', 'appName'],
    },
    card_registered: {
      label: 'Carte enregistrée',
      enabled: true,
      useEmojis: true,
      subjectFr: 'Nouvelle carte enregistrée — {{appName}}',
      subjectEn: 'New card added — {{appName}}',
      bodyFr: `
        <p style="margin:0 0 16px;color:#0f172a;">Bonjour {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">Une carte <strong>{{brand}}</strong> se terminant par <strong>{{last4}}</strong> a été ajoutée à votre compte.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">Si ce n'était pas vous, contactez {{supportEmail}} immédiatement.</p>
      `.trim(),
      bodyEn: `
        <p style="margin:0 0 16px;color:#0f172a;">Hello {{firstName}},</p>
        <p style="margin:0 0 16px;color:#334155;">A <strong>{{brand}}</strong> card ending in <strong>{{last4}}</strong> was added to your account.</p>
        <p style="margin:0;color:#64748b;font-size:14px;">If this wasn't you, contact {{supportEmail}} immediately.</p>
      `.trim(),
      variables: ['firstName', 'brand', 'last4', 'appName', 'supportEmail'],
    },
  };
}

export function wrapEmailHtml(innerBody: string, appName: string, useEmojis: boolean): string {
  const logo = useEmojis ? '🚗' : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:linear-gradient(135deg,#2B5FF5,#1e40af);padding:24px 28px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:0.04em;">${logo} ${appName}</div>
        </td></tr>
        <tr><td style="padding:28px;">${innerBody}</td></tr>
        <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
          © ${new Date().getFullYear()} ${appName}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function stripEmojis(text: string): string {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export function interpolateTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
