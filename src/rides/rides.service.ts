// src/rides/rides.service.ts
import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../common/websocket.gateway';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { randomInt } from 'crypto'; // ✅ FIX #9 : crypto.randomInt (sécurisé)

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const VALID_VEHICLE_TYPES = ['MOTO', 'ECO', 'CONFORT', 'VAN', 'BERLINE', 'SUV', 'LUXE'];
const PIN_MAX_ATTEMPTS = 5;

/** Le PIN n'est visible que par le passager (ou admin). */
function sanitizeRideForViewer<T extends Record<string, unknown>>(
  ride: T,
  viewerId: string,
  viewerRole?: string,
): T {
  if (!ride) return ride;
  if (viewerRole === 'ADMIN') return ride;
  if (ride.passengerId === viewerId) {
    const { pinAttempts: _a, ...rest } = ride;
    return rest as T;
  }
  const { pinCode: _pin, pinAttempts: _a, ...rest } = ride;
  return rest as T;
}

function stripPinFields<T extends Record<string, unknown>>(ride: T): T {
  if (!ride) return ride;
  const { pinCode: _pin, pinAttempts: _a, ...rest } = ride;
  return rest as T;
}

const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['DRIVER_EN_ROUTE', 'CANCELLED'],
  DRIVER_EN_ROUTE: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

function assertStatusTransition(current: string, next: string): void {
  const allowed = ALLOWED_STATUS_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new BadRequestException(
      `Transition de statut invalide : ${current} → ${next}`,
    );
  }
}

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: AppGateway,
    private mail: MailService,
    private notifications: NotificationsService,
    private wallet: WalletService,
    private platformConfig: PlatformConfigService,
  ) {}

  async createRide(passengerId: string, data: any) {
    if (isNaN(data.pickupLat) || isNaN(data.pickupLng) || isNaN(data.dropoffLat) || isNaN(data.dropoffLng)) {
      throw new BadRequestException('Coordonnées GPS invalides');
    }

    const clientDistance =
      typeof data.distanceKm === 'number' && data.distanceKm > 0
        ? data.distanceKm
        : 0;
    const distanceKm =
      clientDistance > 0
        ? clientDistance
        : haversineKm(
            data.pickupLat,
            data.pickupLng,
            data.dropoffLat,
            data.dropoffLng,
          );

    const durationMin =
      typeof data.durationMin === 'number' && data.durationMin > 0
        ? Math.round(data.durationMin)
        : Math.round((distanceKm / 30) * 60);

    let vehicleType = (data.vehicleType || 'ECO').toString().toUpperCase();
    if (!VALID_VEHICLE_TYPES.includes(vehicleType)) vehicleType = 'ECO';

    const estimatedPrice = await this.platformConfig.calculatePriceWithZones({
      distanceKm,
      durationMin,
      vehicleType,
      pickupLat: data.pickupLat,
      pickupLng: data.pickupLng,
    });

    const ride = await this.prisma.ride.create({
      data: {
        passengerId,
        pickupLat:       data.pickupLat,
        pickupLng:       data.pickupLng,
        pickupAddress:   data.pickupAddress,
        dropoffLat:      data.dropoffLat,
        dropoffLng:      data.dropoffLng,
        dropoffAddress:  data.dropoffAddress,
        vehicleType:     vehicleType as any,
        estimatedPrice,
        distanceKm,
        durationMin,
        paymentMethod:   (data.paymentMethod || 'CASH') as any,
        pinCode:         randomInt(100000, 1000000).toString(), // ✅ FIX #9 : crypto.randomInt
        status:          'REQUESTED',
      },
    });

    const radiusKm = await this.platformConfig.getDriverSearchRadiusKm();
    const onlineDrivers = await this.prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        adminApproved: true,
        vehicleType: vehicleType as any,
      },
      select: { userId: true, currentLat: true, currentLng: true },
      take: 200,
    });
    const eligibleDrivers = this.platformConfig.filterDriversByRadius(
      onlineDrivers,
      ride.pickupLat,
      ride.pickupLng,
      radiusKm,
    );

    const ridePayload = {
      id: ride.id,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      estimatedPrice: ride.estimatedPrice,
      distanceKm: ride.distanceKm,
      durationMin: ride.durationMin,
      paymentMethod: ride.paymentMethod,
      vehicleType: ride.vehicleType,
      requestedAt: ride.requestedAt,
      maxDistanceKm: radiusKm,
    };

    for (const d of eligibleDrivers) {
      this.gateway.server.to(`user:${d.userId}`).emit('ride:new', ridePayload);
    }

    const passenger = await this.prisma.user.findUnique({
      where: { id: passengerId },
      select: { email: true, firstName: true, language: true },
    });
    if (passenger?.email) {
      this.mail.sendRideConfirmation(passenger.email, {
        id: ride.id,
        pickupAddress: ride.pickupAddress,
        dropoffAddress: ride.dropoffAddress,
        estimatedPrice: ride.estimatedPrice,
        vehicleType: ride.vehicleType,
      }, passenger.language).catch(() => {});
    }

    // Notifications uniquement aux chauffeurs dans le rayon admin
    await Promise.all(
      eligibleDrivers.map((d) =>
        this.notifications
          .notifyDriverNewRide(d.userId, ride.id, ride.pickupAddress ?? 'Point de départ')
          .catch(() => undefined),
      ),
    );

    return ride;
  }

  async getAvailableRides(driverId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { currentLat: true, currentLng: true, vehicleType: true, adminApproved: true },
    });

    if (!driverProfile?.adminApproved) {
      throw new ForbiddenException('Compte chauffeur non validé par l\'administrateur');
    }

    const staleHours = 2;
    const maxAgeMin = 30;
    const staleCutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);
    const freshCutoff = new Date(Date.now() - maxAgeMin * 60 * 1000);

    await this.prisma.ride.updateMany({
      where: { status: 'REQUESTED', requestedAt: { lt: staleCutoff } },
      data: {
        status: 'CANCELLED',
        cancelReason: 'Expirée — aucun chauffeur disponible',
        cancelledAt: new Date(),
      },
    });

    const allRequested = await this.prisma.ride.findMany({
      where: {
        status: 'REQUESTED',
        requestedAt: { gte: freshCutoff },
        ...(driverProfile.vehicleType ? { vehicleType: driverProfile.vehicleType } : {}),
      },
      include: {
        passenger: {
          select: { firstName: true, lastName: true, avatarUrl: true, phone: true },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    if (driverProfile.currentLat && driverProfile.currentLng) {
      const radiusKm = await this.platformConfig.getDriverSearchRadiusKm();
      return allRequested
        .filter((ride) => {
          const dist = haversineKm(
            driverProfile.currentLat!,
            driverProfile.currentLng!,
            ride.pickupLat, ride.pickupLng,
          );
          return dist <= radiusKm;
        })
        .map(stripPinFields);
    }
    return allRequested.map(stripPinFields);
  }

  async acceptRide(rideId: string, driverId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { adminApproved: true },
    });
    if (!driverProfile?.adminApproved) {
      throw new ForbiddenException('Compte chauffeur non validé par l\'administrateur');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundException('Course introuvable');
      if (ride.status !== 'REQUESTED') throw new BadRequestException('Course déjà prise');

      return tx.ride.update({
        where: { id: rideId },
        data: { driverId, status: 'ACCEPTED', acceptedAt: new Date() },
        include: { passenger: { select: { firstName: true, phone: true } } },
      });
    });

    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: {
        firstName: true, lastName: true, phone: true, avatarUrl: true,
        driverProfile: {
          select: {
            licensePlate: true, vehicleMake: true, vehicleModel: true,
            vehicleColor: true, rating: true,
            currentLat: true, currentLng: true,
          },
        },
      },
    });

    const driverLat = driver?.driverProfile?.currentLat ?? null;
    const driverLng = driver?.driverProfile?.currentLng ?? null;

    this.gateway.server.to(`ride:${rideId}`).emit('ride:accepted', {
      rideId, driverId, status: 'ACCEPTED',
      pickupLat: updated.pickupLat,
      pickupLng: updated.pickupLng,
      dropoffLat: updated.dropoffLat,
      dropoffLng: updated.dropoffLng,
      driver: {
        name: `${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim(),
        phone: driver?.phone,
        avatarUrl: driver?.avatarUrl,
        plate: driver?.driverProfile?.licensePlate,
        vehicle: `${driver?.driverProfile?.vehicleColor ?? ''} ${driver?.driverProfile?.vehicleMake ?? ''} ${driver?.driverProfile?.vehicleModel ?? ''}`.trim(),
        rating: driver?.driverProfile?.rating,
        lat: driverLat,
        lng: driverLng,
      },
    });

    const passenger = await this.prisma.user.findUnique({
      where: { id: updated.passengerId },
      select: { email: true, language: true },
    });
    if (passenger?.email) {
      this.mail.sendRideConfirmation(passenger.email, {
        id: updated.id,
        status: 'ACCEPTED',
        driver: {
          name: `${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim(),
          phone: driver?.phone,
          plate: driver?.driverProfile?.licensePlate,
          vehicle: `${driver?.driverProfile?.vehicleColor ?? ''} ${driver?.driverProfile?.vehicleMake ?? ''} ${driver?.driverProfile?.vehicleModel ?? ''}`.trim(),
        },
      }, passenger.language).catch(() => {});
    }

    const driverName = `${driver?.firstName ?? 'Votre'} chauffeur`.trim();
    await this.notifications.notifyRideAccepted(
      updated.passengerId,
      rideId,
      driverName,
    ).catch(() => {});

    return sanitizeRideForViewer(updated, driverId);
  }

  async updateRideStatus(rideId: string, requesterId: string, status: string, cancelReason?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');

    if (ride.passengerId !== requesterId && ride.driverId !== requesterId) {
      throw new ForbiddenException('Non autorisé');
    }

    assertStatusTransition(ride.status, status);

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: {
        status: status as any,
        cancelReason: cancelReason ?? null,
        ...(status === 'COMPLETED' ? { completedAt: new Date(), finalPrice: ride.estimatedPrice } : {}),
        ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });

    this.gateway.server.to(`ride:${rideId}`).emit('ride:status', { rideId, status });
    if (ride.passengerId) {
      this.gateway.server.to(`user:${ride.passengerId}`).emit('ride:status', { rideId, status });
    }
    if (ride.driverId) {
      this.gateway.server.to(`user:${ride.driverId}`).emit('ride:status', { rideId, status });
    }

    const statusMessages: Record<string, string> = {
      DRIVER_EN_ROUTE: 'Votre chauffeur est en route.',
      ARRIVED: 'Votre chauffeur est arrivé.',
      IN_PROGRESS: 'La course a commencé.',
      COMPLETED: 'Course terminée. Merci d\'avoir voyagé avec Koogwe.',
      CANCELLED: 'La course a été annulée.',
    };
    const msg = statusMessages[status] ?? `Statut : ${status}`;

    if (ride.passengerId) {
      await this.notifications.notifyRideStatus(ride.passengerId, rideId, status, msg).catch(() => {});
    }
    if (ride.driverId && ride.driverId !== requesterId) {
      await this.notifications.notifyRideStatus(ride.driverId, rideId, status, msg).catch(() => {});
    } else if (ride.driverId && status === 'CANCELLED') {
      await this.notifications.notifyRideStatus(ride.driverId, rideId, status, msg).catch(() => {});
    }

    return sanitizeRideForViewer(updated, requesterId);
  }

  async addTip(rideId: string, passengerId: string, amount: number) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.passengerId !== passengerId) throw new ForbiddenException('Non autorisé');
    if (ride.status !== 'COMPLETED') {
      throw new BadRequestException('Pourboire possible uniquement après la course');
    }
    if (!ride.driverId) throw new BadRequestException('Aucun chauffeur associé');

    const result = await this.wallet.transferTip(passengerId, ride.driverId, rideId, amount);
    if (!result.success) throw new BadRequestException(result.message);

    await this.notifications.notifyTipReceived(ride.driverId, amount, rideId).catch(() => {});
    return result;
  }

  async verifyPin(rideId: string, driverId: string, pin: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.driverId !== driverId) throw new ForbiddenException('Non autorisé');
    if (ride.status !== 'ARRIVED') {
      throw new BadRequestException('Le PIN ne peut être saisi qu\'une fois le passager marqué comme arrivé');
    }
    if (ride.pinAttempts >= PIN_MAX_ATTEMPTS) {
      throw new HttpException(
        'Trop de tentatives incorrectes. Contactez le support ou le passager.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (ride.pinCode !== pin) {
      const updated = await this.prisma.ride.update({
        where: { id: rideId },
        data: { pinAttempts: { increment: 1 } },
      });
      const remaining = PIN_MAX_ATTEMPTS - updated.pinAttempts;
      if (remaining <= 0) {
        throw new HttpException(
          'Trop de tentatives incorrectes. Contactez le support ou le passager.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadRequestException(`Code PIN incorrect. ${remaining} tentative(s) restante(s).`);
    }

    await this.prisma.ride.update({
      where: { id: rideId },
      data: { pinAttempts: 0 },
    });

    const updated = await this.updateRideStatus(rideId, driverId, 'IN_PROGRESS');
    return sanitizeRideForViewer(updated, driverId);
  }

  sanitizeRideForUser(ride: Record<string, unknown>, viewerId: string, viewerRole?: string) {
    return sanitizeRideForViewer(ride, viewerId, viewerRole);
  }

  async getUserRides(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: { OR: [{ passengerId: userId }, { driverId: userId }] },
      include: {
        passenger: { select: { id: true, firstName: true, avatarUrl: true } },
        driver: { select: { id: true, firstName: true, avatarUrl: true, driverProfile: { select: { rating: true, licensePlate: true } } } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
    return rides.map((r) => sanitizeRideForViewer(r, userId));
  }

  async getActiveRideForUser(userId: string) {
    const activeStatuses = [
      'REQUESTED',
      'ACCEPTED',
      'DRIVER_EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
    ] as const;

    const ride = await this.prisma.ride.findFirst({
      where: {
        OR: [{ passengerId: userId }, { driverId: userId }],
        status: { in: [...activeStatuses] },
      },
      orderBy: { requestedAt: 'desc' },
      include: {
        passenger: { select: { id: true, firstName: true, phone: true, avatarUrl: true } },
        driver: {
          select: {
            id: true,
            firstName: true,
            phone: true,
            avatarUrl: true,
            driverProfile: {
              select: {
                rating: true,
                licensePlate: true,
                vehicleMake: true,
                vehicleModel: true,
                currentLat: true,
                currentLng: true,
              },
            },
          },
        },
      },
    });
    if (!ride) return null;
    return sanitizeRideForViewer(ride, userId);
  }
}