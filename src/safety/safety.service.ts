import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PanicStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { AppGateway } from '../common/websocket.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SafetyService {
  constructor(
    private prisma: PrismaService,
    private platformConfig: PlatformConfigService,
    private gateway: AppGateway,
    private notifications: NotificationsService,
  ) {}

  async triggerPanic(userId: string, data: { lat?: number; lng?: number; rideId?: string; note?: string }) {
    const security = await this.platformConfig.getSecurity();
    if (security.sosEnabled === false) {
      throw new BadRequestException('Alertes SOS désactivées par l\'administrateur');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const alert = await this.prisma.panicAlert.create({
      data: {
        userId,
        rideId: data.rideId,
        lat: data.lat,
        lng: data.lng,
        note: data.note,
        status: 'ACTIVE',
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    });

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    const payload = {
      id: alert.id,
      userId: alert.userId,
      userName,
      role: user.role,
      lat: alert.lat,
      lng: alert.lng,
      rideId: alert.rideId,
      status: alert.status,
      createdAt: alert.createdAt,
      location: alert.lat != null && alert.lng != null ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}` : null,
      type: 'Alerte SOS',
    };

    this.gateway.server.to('admin').emit('panic:new', payload);

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notifications
        .notify({
          userId: admin.id,
          type: 'PANIC',
          title: 'Alerte SOS',
          body: `${userName} (${user.role}) a déclenché une alerte`,
          data: { panicId: alert.id, lat: alert.lat, lng: alert.lng },
        })
        .catch(() => undefined);
    }

    return payload;
  }

  listPanics(activeOnly = false) {
    return this.prisma.panicAlert.findMany({
      where: activeOnly ? { status: 'ACTIVE' } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        ride: { select: { id: true, pickupAddress: true, dropoffAddress: true, status: true } },
      },
    }).then((rows) =>
      rows.map((a) => ({
        id: a.id,
        status: a.status,
        lat: a.lat,
        lng: a.lng,
        rideId: a.rideId,
        note: a.note,
        createdAt: a.createdAt,
        type: 'Alerte SOS',
        userName: [a.user.firstName, a.user.lastName].filter(Boolean).join(' ') || a.user.email,
        user: a.user,
        location: a.lat != null && a.lng != null ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : null,
      })),
    );
  }

  async resolvePanic(id: string, adminId: string, status: PanicStatus = 'RESOLVED') {
    const existing = await this.prisma.panicAlert.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Alerte introuvable');

    return this.prisma.panicAlert.update({
      where: { id },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedById: adminId,
      },
    });
  }
}
