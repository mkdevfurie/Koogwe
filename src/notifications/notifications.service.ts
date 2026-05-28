import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { FcmService } from './fcm.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private fcm: FcmService,
  ) {}

  async notify(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    const record = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: (params.data ?? undefined) as object | undefined,
      },
    });

    await this.fcm.sendToUser(params.userId, params.title, params.body, {
      notificationId: record.id,
      type: params.type,
      ...(params.data ?? {}),
    }).catch((e) => this.logger.warn(`FCM: ${e.message}`));

    return record;
  }

  async notifyRideAccepted(passengerId: string, rideId: string, driverName: string) {
    return this.notify({
      userId: passengerId,
      type: 'RIDE_ACCEPTED',
      title: 'Chauffeur trouvé',
      body: `${driverName} a accepté votre course.`,
      data: { rideId },
    });
  }

  async notifyDriverNewRide(driverId: string, rideId: string, pickup: string) {
    return this.notify({
      userId: driverId,
      type: 'RIDE_REQUEST',
      title: 'Nouvelle course',
      body: `Prise en charge : ${pickup}`,
      data: { rideId },
    });
  }

  async notifyRideStatus(
    userId: string,
    rideId: string,
    status: string,
    message: string,
  ) {
    const typeMap: Record<string, NotificationType> = {
      DRIVER_EN_ROUTE: 'RIDE_ACCEPTED',
      ARRIVED: 'DRIVER_ARRIVED',
      IN_PROGRESS: 'RIDE_ACCEPTED',
      COMPLETED: 'RIDE_COMPLETED',
      CANCELLED: 'RIDE_CANCELLED',
    };
    return this.notify({
      userId,
      type: typeMap[status] ?? 'RIDE_ACCEPTED',
      title: 'Mise à jour de course',
      body: message,
      data: { rideId, status },
    });
  }

  async notifyTipReceived(driverId: string, amount: number, rideId: string) {
    return this.notify({
      userId: driverId,
      type: 'PAYMENT_RECEIVED',
      title: 'Pourboire reçu',
      body: `Vous avez reçu ${amount.toFixed(2)} € de pourboire.`,
      data: { rideId, amount },
    });
  }
}
