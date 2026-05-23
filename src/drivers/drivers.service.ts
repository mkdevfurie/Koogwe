// src/drivers/drivers.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { parseDocType } from '../common/utils';
import { IsString, IsOptional, IsEnum, IsInt, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleType } from '@prisma/client';

export class CreateDriverProfileDto {
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) vehicleType: VehicleType;
  @ApiProperty() @IsString() vehicleMake: string;
  @ApiProperty() @IsString() vehicleModel: string;
  @ApiProperty() @IsInt() vehicleYear: number;
  @ApiProperty() @IsString() vehiclePlate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleColor?: string;
}

export class UpdateAvailabilityDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE'] })
  availability: 'ONLINE' | 'OFFLINE';
}

export class UpdateLocationDto {
  @ApiProperty() @IsNumber() latitude: number;
  @ApiProperty() @IsNumber() longitude: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() heading?: number;
}

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(private prisma: PrismaService, private mail: MailService) {}

  async createProfile(userId: string, dto: CreateDriverProfileDto) {
    const existing = await this.prisma.driverProfile.findUnique({ where: { userId } });

    if (dto.vehiclePlate) {
      const plateExists = await this.prisma.driverProfile.findFirst({
        where: {
          licensePlate: dto.vehiclePlate,
          ...(existing ? { userId: { not: userId } } : {}),
        },
      });
      if (plateExists) throw new BadRequestException('Cette plaque est déjà utilisée');
    }

    const vehicleData = {
      vehicleType: dto.vehicleType,
      vehicleMake: dto.vehicleMake,
      vehicleModel: dto.vehicleModel,
      vehicleYear: dto.vehicleYear,
      licensePlate: dto.vehiclePlate,
      vehicleColor: dto.vehicleColor,
    };

    if (existing) {
      return this.prisma.driverProfile.update({
        where: { userId },
        data: vehicleData,
      });
    }

    const profile = await this.prisma.driverProfile.create({
      data: { userId, ...vehicleData },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'FACE_VERIFICATION_PENDING' as any },
    });

    return profile;
  }

  async getProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true, phone: true } } },
    });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    return profile;
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    if (!profile.adminApproved) throw new ForbiddenException('Compte non encore validé par l\'admin');

    return this.prisma.driverProfile.update({
      where: { userId },
      data: { isOnline: dto.availability === 'ONLINE' },
      select: { id: true, isOnline: true },
    });
  }

  async updateLocation(userId: string, dto: UpdateLocationDto) {
    return this.prisma.driverProfile.update({
      where: { userId },
      data: { currentLat: dto.latitude, currentLng: dto.longitude, heading: dto.heading, lastLocationAt: new Date() },
      select: { id: true, currentLat: true, currentLng: true },
    });
  }

  async uploadDocument(userId: string, type: string, fileUrl: string) {
    try {
      const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
      if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

      const docType = parseDocType(type);

      return await this.prisma.document.create({
        data: { 
          userId, 
          type: docType, 
          fileUrl, 
          status: 'PENDING' 
        },
      });
    } catch (error) {
      this.logger.error(`Erreur upload document (${type}) pour l'utilisateur ${userId}:`, error);
      throw error;
    }
  }

  async getRideHistory(userId: string, page = 1, limit = 10) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const skip = (page - 1) * limit;
    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where: { driverId: userId },
        orderBy: { requestedAt: 'desc' },
        skip, take: limit,
        select: {
          id: true, status: true, pickupAddress: true, dropoffAddress: true,
          finalPrice: true, estimatedPrice: true, distanceKm: true,
          durationMin: true, completedAt: true, requestedAt: true,
          vehicleType: true, paymentMethod: true,
          passenger: { select: { firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
      this.prisma.ride.count({ where: { driverId: userId } }),
    ]);

    return { data: rides, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getStats(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, totalRides: true, totalEarnings: true, rating: true, ratingCount: true },
    });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [today, month] = await Promise.all([
      this.prisma.ride.aggregate({
        where: { driverId: userId, status: 'COMPLETED', completedAt: { gte: startOfDay } },
        _sum: { finalPrice: true }, _count: { id: true },
      }),
      this.prisma.ride.aggregate({
        where: { driverId: userId, status: 'COMPLETED', completedAt: { gte: startOfMonth } },
        _sum: { finalPrice: true }, _count: { id: true },
      }),
    ]);

    return {
      totalRides: profile.totalRides, totalEarnings: profile.totalEarnings,
      averageRating: profile.rating, ratingCount: profile.ratingCount,
      today: { earnings: today._sum.finalPrice ?? 0, rides: today._count.id },
      month: { earnings: month._sum.finalPrice ?? 0, rides: month._count.id },
    };
  }

  // ✅ FIX V2: approveDriver vérifie les documents avant validation
  async approveDriver(driverId: string) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: { user: { include: { documents: true } } },
    });
    if (!driver) throw new NotFoundException('Profil chauffeur introuvable');

    if (!driver.faceVerified) throw new BadRequestException('Vérification faciale non complétée');
    if (!driver.vehicleMake || !driver.vehicleModel || !driver.licensePlate) {
      throw new BadRequestException('Informations véhicule manquantes');
    }

    const requiredDocs = ['DRIVERS_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'TECHNICAL_CONTROL'];
    const hasAllDocs = requiredDocs.every((t) =>
      driver.user.documents.some((d) => d.type === t && d.status === 'APPROVED'),
    );
    if (!hasAllDocs) throw new BadRequestException('Tous les documents requis doivent être approuvés');

    const updated = await this.prisma.driverProfile.update({
      where: { id: driverId },
      data: { adminApproved: true, adminApprovedAt: new Date() },
      include: { user: { select: { email: true, firstName: true } } },
    });

    await this.prisma.user.update({
      where: { id: driver.userId },
      data: { accountStatus: 'ACTIVE', isVerified: true },
    });

    this.mail.sendDriverApproved(updated.user.email, updated.user.firstName ?? 'Chauffeur').catch(() => {});
    return updated;
  }

  async rejectDriver(driverId: string, reason?: string) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!driver) throw new NotFoundException('Profil introuvable');

    await this.prisma.driverProfile.update({ where: { id: driverId }, data: { adminApproved: false } });
    await this.prisma.user.update({ where: { id: driver.userId }, data: { accountStatus: 'REJECTED' } });
    this.mail.sendDriverRejected(driver.user.email, driver.user.firstName ?? 'Chauffeur', reason).catch(() => {});
    return { success: true, message: 'Chauffeur rejeté' };
  }

  async getPendingDrivers() {
    return this.prisma.driverProfile.findMany({
      where: { adminApproved: false },
      include: {
        user: { select: { email: true, firstName: true, lastName: true, createdAt: true, accountStatus: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}