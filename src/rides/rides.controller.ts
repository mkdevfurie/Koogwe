// src/rides/rides.controller.ts
import {
  Controller, Post, Get, Patch, Param, Body, Request,
  UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RidesService } from './rides.service';
import { AdminService } from '../admin/admin.service';
import { PromoService } from '../promos/promo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

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

function resolveTripMetrics(body: {
  distanceKm?: number;
  durationMin?: number;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
}): { distanceKm: number; durationMin: number } {
  let distanceKm =
    typeof body.distanceKm === 'number' && body.distanceKm > 0
      ? body.distanceKm
      : 0;
  let durationMin =
    typeof body.durationMin === 'number' && body.durationMin > 0
      ? Math.round(body.durationMin)
      : 0;

  if (
    distanceKm <= 0 &&
    typeof body.pickupLat === 'number' &&
    typeof body.pickupLng === 'number' &&
    typeof body.dropoffLat === 'number' &&
    typeof body.dropoffLng === 'number'
  ) {
    distanceKm = haversineKm(
      body.pickupLat,
      body.pickupLng,
      body.dropoffLat,
      body.dropoffLng,
    );
  }
  if (durationMin <= 0 && distanceKm > 0) {
    durationMin = Math.max(1, Math.round((distanceKm / 30) * 60));
  }
  return { distanceKm, durationMin };
}

@ApiTags('Rides')
@ApiBearerAuth()
@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly adminService: AdminService,
    private readonly promoService: PromoService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('promo/validate')
  @HttpCode(HttpStatus.OK)
  async validatePromo(
    @Request() req: { user: { id: string; role: string } },
    @Body() body: { code: string; basePrice: number },
  ) {
    return this.promoService.validate(
      body.code,
      req.user.id,
      req.user.role as any,
      Number(body.basePrice),
    );
  }

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  async estimatePrice(
    @Request() req: { user: { id: string; role: string } },
    @Body()
    body: {
      distanceKm: number;
      durationMin: number;
      vehicleType: string;
      pickupLat?: number;
      pickupLng?: number;
      dropoffLat?: number;
      dropoffLng?: number;
      promoCode?: string;
    },
  ) {
    const metrics = resolveTripMetrics(body);
    const result = await this.adminService.estimatePrice({
      distanceKm: metrics.distanceKm,
      durationMin: metrics.durationMin,
      vehicleType: body.vehicleType,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
    });
    if (body.promoCode?.trim()) {
      const promo = await this.promoService.validate(
        body.promoCode,
        req.user.id,
        req.user.role as any,
        result.estimate,
      );
      return {
        ...result,
        estimate: promo.finalPrice,
        promo: {
          code: promo.code,
          discountAmount: promo.discountAmount,
          basePrice: promo.basePrice,
        },
      };
    }
    return result;
  }

  @Post()
  createRide(@Request() req: any, @Body() body: any) {
    return this.ridesService.createRide(req.user.id, body);
  }

  @Get('available')
  getAvailableRides(@Request() req: any) {
    return this.ridesService.getAvailableRides(req.user.id);
  }

  @Get('history')
  getHistory(@Request() req: any) {
    return this.ridesService.getUserRides(req.user.id);
  }

  @Get('driver/stats')
  async getDriverStats(@Request() req: any) {
    const userId = req.user.id;
    const [totalRides, completed, cancelled, revenue] = await Promise.all([
      this.prisma.ride.count({ where: { driverId: userId } }),
      this.prisma.ride.count({ where: { driverId: userId, status: 'COMPLETED' } }),
      this.prisma.ride.count({ where: { driverId: userId, status: 'CANCELLED' } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { driverId: userId, status: 'COMPLETED' },
      }),
    ]);
    return { totalRides, completed, cancelled, revenue: revenue._sum.finalPrice ?? 0 };
  }

  @Get('me')
  getMyRides(@Request() req: any) {
    return this.ridesService.getUserRides(req.user.id);
  }

  @Get('active')
  @ApiOperation({ summary: 'Course en cours pour l\'utilisateur connecté' })
  getActiveRide(@Request() req: any) {
    return this.ridesService.getActiveRideForUser(req.user.id);
  }

  @Get(':id')
  async getRideById(@Request() req: any, @Param('id') rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        passenger: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true },
        },
        driver: {
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true,
            driverProfile: {
              select: { vehicleMake: true, vehicleModel: true, vehicleColor: true, licensePlate: true, rating: true },
            },
          },
        },
        payment: true,
      },
    });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.passengerId !== req.user.id && ride.driverId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new NotFoundException('Course introuvable');
    }
    return this.ridesService.sanitizeRideForUser(ride, req.user.id, req.user.role);
  }

  @Post(':id/accept')
  acceptRide(@Request() req: any, @Param('id') rideId: string) {
    return this.ridesService.acceptRide(rideId, req.user.id);
  }

  @Patch(':id/status')
  updateStatus(
    @Request() req: any,
    @Param('id') rideId: string,
    @Body() body: { status: string; cancelReason?: string },
  ) {
    return this.ridesService.updateRideStatus(rideId, req.user.id, body.status, body.cancelReason);
  }

  @Post(':id/cancel')
  cancelRide(@Request() req: any, @Param('id') rideId: string, @Body() body: { reason?: string }) {
    return this.ridesService.updateRideStatus(rideId, req.user.id, 'CANCELLED', body?.reason);
  }

  @Post(':id/verify-pin')
  verifyPin(@Request() req: any, @Param('id') rideId: string, @Body() body: { pin: string }) {
    return this.ridesService.verifyPin(rideId, req.user.id, body.pin);
  }

  @Post(':id/tip')
  @ApiOperation({ summary: 'Envoyer un pourboire au chauffeur (wallet)' })
  addTip(
    @Request() req: any,
    @Param('id') rideId: string,
    @Body() body: { amount: number },
  ) {
    return this.ridesService.addTip(rideId, req.user.id, body.amount);
  }

  @Post(':id/review')
  reviewRide(
    @Request() req: any,
    @Param('id') rideId: string,
    @Body() body: { rating: number; comment?: string; targetId?: string },
  ) {
    return this.submitReview(req.user.id, rideId, body.rating, body.comment);
  }

  @Post(':id/rate')
  rateRide(
    @Request() req: any,
    @Param('id') rideId: string,
    @Body() body: { rating: number; comment?: string },
  ) {
    return this.submitReview(req.user.id, rideId, body.rating, body.comment);
  }

  private async submitReview(userId: string, rideId: string, rating: number, comment?: string) {
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      throw new BadRequestException('La note doit être entre 1 et 5');
    }

    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.status !== 'COMPLETED') {
      throw new BadRequestException('Vous ne pouvez noter qu\'une course terminée');
    }

    const isPassenger = ride.passengerId === userId;
    const isDriver = ride.driverId === userId;
    if (!isPassenger && !isDriver) throw new NotFoundException('Course introuvable');

    const data: any = {};
    if (isPassenger) {
      data.driverRating = rating;
      if (comment) data.driverComment = comment;
    } else {
      data.passengerRating = rating;
      if (comment) data.passengerComment = comment;
    }

    await this.prisma.ride.update({ where: { id: rideId }, data });

    if (isPassenger && ride.driverId) {
      const stats = await this.prisma.ride.aggregate({
        _avg: { driverRating: true },
        where: { driverId: ride.driverId, driverRating: { not: null } },
      });
      const avg = stats._avg.driverRating;
      if (typeof avg === 'number') {
        await this.prisma.driverProfile
          .updateMany({ where: { userId: ride.driverId }, data: { rating: avg } })
          .catch(() => undefined);
      }
    }

    return { success: true, message: 'Merci pour votre évaluation' };
  }
}