// src/rides/rides.service.ts
import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../common/websocket.gateway';
import { MailService } from '../mail/mail.service';

function calculatePrice(params: {
  distanceKm: number; durationMin: number; vehicleType: string;
}): number {
  const { distanceKm, durationMin, vehicleType } = params;

  const PRISE_EN_CHARGE = Number(process.env.PRICING_PICKUP_FEE ?? 3);
  const TARIF_KM: Record<string, number> = {
    MOTO:    Number(process.env.PRICING_KM_MOTO    ?? 1.0),
    ECO:     Number(process.env.PRICING_KM_ECO     ?? 1.2),
    CONFORT: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
    VAN:     Number(process.env.PRICING_KM_VAN     ?? 1.9),
    BERLINE: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
    SUV:     Number(process.env.PRICING_KM_VAN     ?? 1.9),
    LUXE:    Number(process.env.PRICING_KM_LUXE    ?? 2.5),
  };
  const TARIF_MIN = Number(process.env.PRICING_MINUTE_RATE ?? 0.30);
  const MINIMUM   = Number(process.env.PRICING_MIN_PRICE   ?? 7);

  const vt = vehicleType.toUpperCase();
  const tarifKm = TARIF_KM[vt] ?? TARIF_KM['ECO'];

  const hour = new Date().getHours();
  let coeffHoraire = 1.0;
  if (hour >= 7 && hour <= 9)   coeffHoraire = 1.3;
  if (hour >= 17 && hour <= 20) coeffHoraire = 1.3;
  if (hour >= 22 || hour <= 5)  coeffHoraire = 1.4;

  const prixBase = PRISE_EN_CHARGE + distanceKm * tarifKm + durationMin * TARIF_MIN;
  const prixFinal = Math.max(prixBase * coeffHoraire, MINIMUM);
  return Math.round(prixFinal * 100) / 100;
}

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

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: AppGateway,
    private mail: MailService,
  ) {}

  async createRide(passengerId: string, data: any) {
    if (isNaN(data.pickupLat) || isNaN(data.pickupLng) || isNaN(data.dropoffLat) || isNaN(data.dropoffLng)) {
      throw new BadRequestException('Coordonnées GPS invalides');
    }

    const distanceKm: number =
      typeof data.distanceKm === 'number' && data.distanceKm > 0
        ? data.distanceKm
        : haversineKm(data.pickupLat, data.pickupLng, data.dropoffLat, data.dropoffLng);

    const durationMin: number =
      typeof data.durationMin === 'number' && data.durationMin > 0
        ? data.durationMin
        : Math.round((distanceKm / 30) * 60);

    let vehicleType = (data.vehicleType || 'ECO').toString().toUpperCase();
    if (!VALID_VEHICLE_TYPES.includes(vehicleType)) vehicleType = 'ECO';

    const estimatedPrice = calculatePrice({ distanceKm, durationMin, vehicleType });

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
        pinCode:         Math.floor(100000 + Math.random() * 900000).toString(),
        status:          'REQUESTED',
      },
    });

    this.gateway.server.emit('ride:new', {
      id: ride.id,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      estimatedPrice: ride.estimatedPrice,
      vehicleType: ride.vehicleType,
      requestedAt: ride.requestedAt,
    });

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

    const allRequested = await this.prisma.ride.findMany({
      where: {
        status: 'REQUESTED',
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
      const radiusKm = Number(process.env.DRIVER_SEARCH_RADIUS_KM ?? 30);
      return allRequested.filter((ride) => {
        const dist = haversineKm(
          driverProfile.currentLat!,
          driverProfile.currentLng!,
          ride.pickupLat, ride.pickupLng,
        );
        return dist <= radiusKm;
      });
    }
    return allRequested;
  }

  async acceptRide(rideId: string, driverId: string) {
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
          },
        },
      },
    });

    this.gateway.server.to(`ride:${rideId}`).emit('ride:accepted', {
      rideId, driverId, status: 'ACCEPTED',
      driver: {
        name: `${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim(),
        phone: driver?.phone,
        avatarUrl: driver?.avatarUrl,
        plate: driver?.driverProfile?.licensePlate,
        vehicle: `${driver?.driverProfile?.vehicleColor ?? ''} ${driver?.driverProfile?.vehicleMake ?? ''} ${driver?.driverProfile?.vehicleModel ?? ''}`.trim(),
        rating: driver?.driverProfile?.rating,
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

    return updated;
  }

  async updateRideStatus(rideId: string, requesterId: string, status: string, cancelReason?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');

    if (ride.passengerId !== requesterId && ride.driverId !== requesterId) {
      throw new ForbiddenException('Non autorisé');
    }

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
    return updated;
  }

  async verifyPin(rideId: string, driverId: string, pin: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.driverId !== driverId) throw new ForbiddenException('Non autorisé');
    if (ride.pinCode !== pin) throw new BadRequestException('Code PIN incorrect');

    return this.updateRideStatus(rideId, driverId, 'IN_PROGRESS');
  }

  async getUserRides(userId: string) {
    return this.prisma.ride.findMany({
      where: { OR: [{ passengerId: userId }, { driverId: userId }] },
      include: {
        passenger: { select: { id: true, firstName: true, avatarUrl: true } },
        driver: { select: { id: true, firstName: true, avatarUrl: true, driverProfile: { select: { rating: true, licensePlate: true } } } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
  }
}