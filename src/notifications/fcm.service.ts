import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private messaging: any = null;

  constructor(private prisma: PrismaService) {
    this.initFirebase();
  }

  private initFirebase() {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!json?.trim()) return;

    try {
      const admin = require('firebase-admin');
      if (admin.apps.length === 0) {
        const cred = JSON.parse(json);
        admin.initializeApp({ credential: admin.credential.cert(cred) });
      }
      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin initialisé (push FCM actif)');
    } catch (e) {
      this.logger.warn(`Firebase Admin non disponible: ${(e as Error).message}`);
    }
  }

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.messaging) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, notifPushEnabled: true },
    });
    if (!user?.fcmToken || user.notifPushEnabled === false) return;

    const stringData: Record<string, string> = {};
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        stringData[k] = String(v);
      }
    }

    await this.messaging.send({
      token: user.fcmToken,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  }
}
