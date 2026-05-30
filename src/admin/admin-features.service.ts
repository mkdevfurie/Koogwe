import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisputeStatus, NotificationType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Resend } from 'resend';

@Injectable()
export class AdminFeaturesService {
  private resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── Live map ─────────────────────────────────────────────────────────────

  async getLiveMapData() {
    const [drivers, rides] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where: { isOnline: true, currentLat: { not: null }, currentLng: { not: null } },
        select: {
          id: true,
          currentLat: true,
          currentLng: true,
          heading: true,
          vehicleType: true,
          lastLocationAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.ride.findMany({
        where: {
          status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
        },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropoffLat: true,
          dropoffLng: true,
          pickupAddress: true,
          dropoffAddress: true,
          estimatedPrice: true,
          vehicleType: true,
          passenger: { select: { firstName: true, lastName: true } },
          driver: { select: { firstName: true, lastName: true } },
        },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      drivers: drivers.map((d) => ({
        id: d.id,
        userId: d.user.id,
        name: [d.user.firstName, d.user.lastName].filter(Boolean).join(' ') || d.user.email,
        lat: d.currentLat,
        lng: d.currentLng,
        heading: d.heading,
        vehicleType: d.vehicleType,
        lastLocationAt: d.lastLocationAt,
      })),
      rides,
      updatedAt: new Date().toISOString(),
    };
  }

  // ─── Trends ───────────────────────────────────────────────────────────────

  async getDashboardTrends() {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const pct = (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 1000) / 10;
    };

    const [
      driversNow, driversPrev,
      passengersNow, passengersPrev,
      ridesNow, ridesPrev,
      revenueNow, revenuePrev,
      activeDriversNow,
    ] = await Promise.all([
      this.prisma.driverProfile.count({ where: { createdAt: { gte: thisMonthStart } } }),
      this.prisma.driverProfile.count({ where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      this.prisma.user.count({ where: { role: 'PASSENGER', createdAt: { gte: thisMonthStart } } }),
      this.prisma.user.count({ where: { role: 'PASSENGER', createdAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      this.prisma.ride.count({ where: { requestedAt: { gte: thisMonthStart } } }),
      this.prisma.ride.count({ where: { requestedAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: thisMonthStart } },
      }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: prevMonthStart, lte: prevMonthEnd } },
      }),
      this.prisma.driverProfile.count({ where: { isOnline: true } }),
    ]);

    const revNow = revenueNow._sum.finalPrice ?? 0;
    const revPrev = revenuePrev._sum.finalPrice ?? 0;

    return {
      drivers: { value: driversNow, trend: pct(driversNow, driversPrev), activeOnline: activeDriversNow },
      passengers: { value: passengersNow, trend: pct(passengersNow, passengersPrev) },
      rides: { value: ridesNow, trend: pct(ridesNow, ridesPrev) },
      revenue: { value: revNow, trend: pct(revNow, revPrev) },
      period: 'month',
    };
  }

  // ─── Push broadcast ───────────────────────────────────────────────────────

  async broadcastNotification(params: {
    title: string;
    body: string;
    target: 'ALL' | 'PASSENGER' | 'DRIVER';
    type?: NotificationType;
  }) {
    const where: Prisma.UserWhereInput =
      params.target === 'ALL'
        ? { role: { in: ['PASSENGER', 'DRIVER'] }, isActive: true }
        : { role: params.target, isActive: true };

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
      take: 5000,
    });

    let sent = 0;
    for (const u of users) {
      await this.notifications
        .notify({
          userId: u.id,
          type: params.type ?? 'ADMIN_ACTION',
          title: params.title,
          body: params.body,
          data: { broadcast: true },
        })
        .catch(() => undefined);
      sent++;
    }
    return { sent, target: params.target };
  }

  async searchNotificationTargets(q: string, role?: UserRole) {
    const term = q?.trim()
    if (!term || term.length < 2) return []

    const where: Prisma.UserWhereInput = {
      role: role ?? { in: ['PASSENGER', 'DRIVER'] },
      isActive: true,
      OR: [
        { email: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ],
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        fcmToken: true,
        notifPushEnabled: true,
      },
      orderBy: { email: 'asc' },
      take: 25,
    })
  }

  async sendNotificationToUser(params: {
    userId: string
    title: string
    body: string
    type?: NotificationType
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, role: true, email: true, fcmToken: true, notifPushEnabled: true },
    })
    if (!user || (user.role !== 'PASSENGER' && user.role !== 'DRIVER')) {
      throw new NotFoundException('Utilisateur introuvable')
    }

    await this.notifications.notify({
      userId: user.id,
      type: params.type ?? 'ADMIN_ACTION',
      title: params.title,
      body: params.body,
      data: { fromAdmin: true },
    })

    return {
      success: true,
      userId: user.id,
      email: user.email,
      role: user.role,
      pushAvailable: Boolean(user.fcmToken && user.notifPushEnabled !== false),
    }
  }

  // ─── Disputes ─────────────────────────────────────────────────────────────

  listDisputes(status?: DisputeStatus) {
    return this.prisma.dispute.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        ride: {
          select: {
            id: true,
            pickupAddress: true,
            dropoffAddress: true,
            finalPrice: true,
            status: true,
          },
        },
        reporter: { select: { id: true, email: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }

  async createDispute(data: {
    rideId?: string;
    reporterId?: string;
    reason: string;
    rating?: number;
  }) {
    return this.prisma.dispute.create({
      data: {
        rideId: data.rideId,
        reporterId: data.reporterId,
        reason: data.reason,
        rating: data.rating,
        status: 'OPEN',
      },
    });
  }

  async updateDispute(
    id: string,
    data: {
      status?: DisputeStatus;
      adminNotes?: string;
      refundAmount?: number;
      resolvedById?: string;
    },
  ) {
    const existing = await this.prisma.dispute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Litige introuvable');

    const resolved = data.status === 'RESOLVED' || data.status === 'REFUNDED';
    return this.prisma.dispute.update({
      where: { id },
      data: {
        ...data,
        resolvedAt: resolved ? new Date() : existing.resolvedAt,
      },
    });
  }

  async scanLowRatingDisputes() {
    const lowReviews = await this.prisma.review.findMany({
      where: { rating: { lte: 2 } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { ride: true },
    });

    let created = 0;
    for (const r of lowReviews) {
      const exists = await this.prisma.dispute.findFirst({
        where: { rideId: r.rideId, reason: { contains: 'Note basse' } },
      });
      if (exists || !r.rideId) continue;
      await this.prisma.dispute.create({
        data: {
          rideId: r.rideId,
          reporterId: r.authorId,
          reason: `Note basse auto (${r.rating}/5): ${r.comment ?? '—'}`,
          rating: Math.round(r.rating),
          status: 'OPEN',
        },
      });
      created++;
    }
    return { scanned: lowReviews.length, created };
  }

  // ─── Promos ───────────────────────────────────────────────────────────────

  listPromos() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createPromo(data: {
    code: string;
    label?: string;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue: number;
    maxUses?: number;
    validFrom?: string;
    validUntil?: string;
    targetRole?: UserRole;
    isActive?: boolean;
  }) {
    return this.prisma.promoCode.create({
      data: {
        code: data.code.toUpperCase().trim(),
        label: data.label,
        discountType: data.discountType ?? 'PERCENT',
        discountValue: data.discountValue,
        maxUses: data.maxUses,
        validFrom: data.validFrom ? new Date(data.validFrom) : undefined,
        validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
        targetRole: data.targetRole,
        isActive: data.isActive ?? true,
      },
    });
  }

  async updatePromo(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Code promo introuvable');
    return this.prisma.promoCode.update({
      where: { id },
      data: {
        ...data,
        code: typeof data.code === 'string' ? data.code.toUpperCase().trim() : undefined,
        validFrom: data.validFrom ? new Date(String(data.validFrom)) : undefined,
        validUntil: data.validUntil ? new Date(String(data.validUntil)) : undefined,
      },
    });
  }

  async deletePromo(id: string) {
    await this.prisma.promoCode.delete({ where: { id } });
    return { success: true };
  }

  // ─── FAQ ──────────────────────────────────────────────────────────────────

  listFaq(activeOnly = false) {
    return this.prisma.faqEntry.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createFaq(data: {
    questionFr: string;
    questionEn?: string;
    answerFr: string;
    answerEn?: string;
    category?: string;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    return this.prisma.faqEntry.create({ data });
  }

  async updateFaq(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('FAQ introuvable');
    return this.prisma.faqEntry.update({ where: { id }, data });
  }

  async deleteFaq(id: string) {
    await this.prisma.faqEntry.delete({ where: { id } });
    return { success: true };
  }

  // ─── Exports CSV ──────────────────────────────────────────────────────────

  private csvEscape(v: unknown) {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  }

  async exportRidesCsv(from?: string, to?: string) {
    const where: Prisma.RideWhereInput = {};
    if (from || to) {
      where.requestedAt = {};
      if (from) where.requestedAt.gte = new Date(from);
      if (to) where.requestedAt.lte = new Date(to);
    }
    const rows = await this.prisma.ride.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 10000,
      include: {
        passenger: { select: { email: true, firstName: true, lastName: true } },
        driver: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    const header = ['id', 'status', 'passenger', 'driver', 'pickup', 'dropoff', 'price', 'requestedAt'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.status,
          r.passenger?.email,
          r.driver?.email ?? '',
          r.pickupAddress,
          r.dropoffAddress,
          r.finalPrice ?? r.estimatedPrice,
          r.requestedAt.toISOString(),
        ].map((c) => this.csvEscape(c)).join(','),
      ),
    ];
    return lines.join('\n');
  }

  async exportDriversCsv() {
    const rows = await this.prisma.driverProfile.findMany({
      include: { user: { select: { email: true, firstName: true, lastName: true, accountStatus: true } } },
    });
    const header = ['id', 'email', 'name', 'vehicleType', 'isOnline', 'adminApproved', 'totalRides', 'rating'];
    const lines = [
      header.join(','),
      ...rows.map((d) =>
        [
          d.id,
          d.user.email,
          [d.user.firstName, d.user.lastName].filter(Boolean).join(' '),
          d.vehicleType,
          d.isOnline,
          d.adminApproved,
          d.totalRides,
          d.rating,
        ].map((c) => this.csvEscape(c)).join(','),
      ),
    ];
    return lines.join('\n');
  }

  async exportRevenueCsv(from?: string, to?: string) {
    const where: Prisma.RideWhereInput = { status: 'COMPLETED' };
    if (from || to) {
      where.completedAt = {};
      if (from) where.completedAt.gte = new Date(from);
      if (to) where.completedAt.lte = new Date(to);
    }
    const rows = await this.prisma.ride.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      take: 10000,
      select: {
        id: true,
        completedAt: true,
        finalPrice: true,
        paymentMethod: true,
        passenger: { select: { email: true } },
        driver: { select: { email: true } },
      },
    });
    const header = ['rideId', 'completedAt', 'amount', 'paymentMethod', 'passenger', 'driver'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.id, r.completedAt?.toISOString(), r.finalPrice, r.paymentMethod, r.passenger?.email, r.driver?.email ?? '']
          .map((c) => this.csvEscape(c))
          .join(','),
      ),
    ];
    return lines.join('\n');
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  async getDetailedHealth() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (e) {
      checks.database = { ok: false, detail: e?.message };
    }

    if (this.resend) {
      checks.resend = { ok: !!process.env.RESEND_API_KEY, detail: process.env.RESEND_FROM ?? 'default from' };
    } else {
      checks.resend = { ok: false, detail: 'RESEND_API_KEY manquant' };
    }

    checks.stripe = {
      ok: !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_KEY),
      detail: process.env.STRIPE_SECRET_KEY ? 'configuré' : 'non configuré',
    };

    checks.mapbox = {
      ok: !!(process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN),
      detail: process.env.MAPBOX_ACCESS_TOKEN ? 'configuré' : 'non configuré',
    };

    checks.firebase = {
      ok: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      detail: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'FCM configuré' : 'FCM non configuré',
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  // ─── Admin users / roles ──────────────────────────────────────────────────

  listAdminUsers() {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        adminRole: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateAdminRole(userId: string, adminRole: 'SUPER_ADMIN' | 'SUPPORT' | 'READONLY') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'ADMIN') {
      throw new BadRequestException('Utilisateur admin introuvable');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { adminRole },
      select: { id: true, email: true, adminRole: true },
    });
  }
}
