// src/rides/rides.controller.ts
import {
  Controller, Post, Get, Patch, Param, Body, Request,
  UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RidesService } from './rides.service';
import { AdminService } from '../admin/admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Rides')
@ApiBearerAuth()
@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly adminService: AdminService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimatePrice(@Body() body: { distanceKm: number; durationMin: number; vehicleType: string }) {
    return this.adminService.estimatePrice({
      distanceKm: body.distanceKm,
      durationMin: body.durationMin,
      vehicleType: body.vehicleType,
    });
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
    return ride;
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