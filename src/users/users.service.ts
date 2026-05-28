// src/users/users.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() avatarUrl?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'es', 'pt', 'ht'] })
  @IsOptional() @IsIn(['fr', 'en', 'es', 'pt', 'ht']) language?: string;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleMake?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleColor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() licensePlate?: string;
  @ApiPropertyOptional() @IsOptional() vehicleYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleType?: string;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        avatarUrl: true, phone: true, role: true, isVerified: true,
        language: true, accountStatus: true, createdAt: true,
        faceVerified: true,
        driverProfile: {
          select: {
            id: true, isOnline: true, adminApproved: true,
            faceVerified: true, documentsUploaded: true,
            vehicleType: true, vehicleMake: true, vehicleModel: true,
            vehicleColor: true, licensePlate: true,
            rating: true, totalRides: true, totalEarnings: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true, phone: true, language: true },
    });
  }

  // ── Vehicle info (V1 flow) ──────────────────────────────────────────────
  async updateVehicle(userId: string, dto: UpdateVehicleDto) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const updated = await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        vehicleMake: dto.vehicleMake,
        vehicleModel: dto.vehicleModel,
        vehicleColor: dto.vehicleColor,
        licensePlate: dto.licensePlate,
        vehicleYear: dto.vehicleYear,
        vehicleType: (dto.vehicleType as any) ?? profile.vehicleType,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'DOCUMENTS_PENDING' as any },
    });

    return updated;
  }

  // ── Driver onboarding status ────────────────────────────────────────────
  async getDriverStatus(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    const currentStep =
      !profile.faceVerified ? 'face_verification' :
      (!profile.vehicleMake || !profile.vehicleModel || !profile.licensePlate) ? 'vehicle_registration' :
      !profile.documentsUploaded ? 'documents_upload' :
      !profile.adminApproved ? 'pending_admin' : 'active';

    return {
      faceVerified: profile.faceVerified,
      documentsUploaded: profile.documentsUploaded,
      adminApproved: profile.adminApproved,
      currentStep,
    };
  }

  async markDocumentsUploaded(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');

    await this.prisma.driverProfile.update({
      where: { userId },
      data: { documentsUploaded: true, documentsUploadedAt: new Date() },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'ADMIN_REVIEW_PENDING' as any },
    });

    return { success: true, message: 'Documents soumis — en attente de validation admin' };
  }

  // ── Ride history ────────────────────────────────────────────────────────
  async getRideHistory(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where: { passengerId: userId },
        orderBy: { requestedAt: 'desc' },
        skip, take: limit,
        select: {
          id: true, status: true, pickupAddress: true, dropoffAddress: true,
          finalPrice: true, estimatedPrice: true, distanceKm: true,
          durationMin: true, completedAt: true, requestedAt: true,
          vehicleType: true, paymentMethod: true, isPaid: true,
          driverId: true,
        },
      }),
      this.prisma.ride.count({ where: { passengerId: userId } }),
    ]);
    return { data: rides, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ── Notifications ───────────────────────────────────────────────────────
  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationRead(notifId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notifId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllNotificationsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async updatePreferences(
    userId: string,
    dto: { notifPushEnabled?: boolean; notifEmailEnabled?: boolean },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.notifPushEnabled !== undefined ? { notifPushEnabled: dto.notifPushEnabled } : {}),
        ...(dto.notifEmailEnabled !== undefined ? { notifEmailEnabled: dto.notifEmailEnabled } : {}),
      },
      select: {
        id: true,
        notifPushEnabled: true,
        notifEmailEnabled: true,
      },
    });
  }

  async updatePaypalEmail(userId: string, paypalEmail: string) {
    const email = paypalEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new BadRequestException('Email PayPal invalide');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { paypalEmail: email },
      select: { id: true, paypalEmail: true },
    });
  }

  async deactivateAccount(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        refreshToken: null,
        fcmToken: null,
      },
    });
    return { success: true, message: 'Compte désactivé' };
  }

  // ── Saved places ────────────────────────────────────────────────────────
  async getSavedPlaces(userId: string) {
    return this.prisma.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async addSavedPlace(userId: string, data: { label: string; address: string; lat: number; lng: number }) {
    return this.prisma.savedPlace.create({ data: { userId, ...data } });
  }

  async removeSavedPlace(userId: string, placeId: string) {
    const place = await this.prisma.savedPlace.findUnique({ where: { id: placeId } });
    if (!place || place.userId !== userId) throw new NotFoundException('Lieu introuvable');
    await this.prisma.savedPlace.delete({ where: { id: placeId } });
    return { success: true };
  }
}
