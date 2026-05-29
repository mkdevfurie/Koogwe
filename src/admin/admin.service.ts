// src/admin/admin.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AppGateway } from '../common/websocket.gateway';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { DocumentStatus, DocumentType } from '@prisma/client';

// Documents requis pour qu'un chauffeur soit auto-activé après approbation
const REQUIRED_DRIVER_DOCS: DocumentType[] = [
  DocumentType.DRIVERS_LICENSE,
  DocumentType.VEHICLE_REGISTRATION,
  DocumentType.INSURANCE,
  DocumentType.TECHNICAL_CONTROL,
];

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private gateway: AppGateway,
    private platformConfig: PlatformConfigService,
  ) {}

  private formatUserDisplayName(user?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null) {
    return (
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      user?.email ||
      'Inconnu'
    );
  }

  private mapDocumentForAdmin<T extends { fileUrl: string; user?: any }>(doc: T) {
    const u = doc.user;
    const driverName = this.formatUserDisplayName(u);
    return {
      ...doc,
      url: doc.fileUrl,
      driverName,
      uploaderName: driverName,
      uploaderEmail: u?.email ?? null,
      uploaderId: u?.id ?? null,
    };
  }

  private emitDocumentUpdated(documentId: string, status: string, userId?: string) {
    this.gateway.server?.to('admin').emit('document:updated', {
      topic: 'document',
      documentId,
      status,
      userId,
    });
  }

  /**
   * 🔧 HELPER : trouve un driverProfile par son id OU par l'id du user lié.
   * Le dashboard admin envoie tantôt user.id (depuis la liste des chauffeurs),
   * tantôt driverProfile.id (depuis le détail) — on supporte les deux.
   */
  private async findDriverByIdOrUserId(id: string) {
    let driver = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!driver) {
      driver = await this.prisma.driverProfile.findUnique({
        where: { userId: id },
        include: { user: true },
      });
    }
    return driver;
  }

  // ─── Dashboard Stats ───────────────────────────────────────────────────────
  async getDashboardStats() {
    const [
      totalPassengers,
      totalDrivers,
      pendingDrivers,
      totalRides,
      activeRides,
      completedRides,
      cancelledRides,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'PASSENGER' } }),
      this.prisma.driverProfile.count(),
      this.prisma.driverProfile.count({ where: { adminApproved: false, documentsUploaded: true } }),
      this.prisma.ride.count(),
      this.prisma.ride.count({ where: { status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } }),
      this.prisma.ride.count({ where: { status: 'COMPLETED' } }),
      this.prisma.ride.count({ where: { status: 'CANCELLED' } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED' },
      }),
    ]);

    return {
      passengers: { total: totalPassengers },
      drivers: { total: totalDrivers, pending: pendingDrivers },
      rides: {
        total: totalRides,
        active: activeRides,
        completed: completedRides,
        cancelled: cancelledRides,
      },
      revenue: {
        total: totalRevenue._sum.finalPrice ?? 0,
      },
    };
  }

  // ─── Courses récentes ──────────────────────────────────────────────────────
  async getRecentRides(limit = 10) {
    return this.prisma.ride.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        driver: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      },
    });
  }

  // ─── Documents en attente ──────────────────────────────────────────────────
  async getPendingDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: 'PENDING' },
      orderBy: { uploadedAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return docs.map((d) => this.mapDocumentForAdmin(d));
  }

  // ─── Chauffeurs ────────────────────────────────────────────────────────────
  async getAllDrivers() {
    return this.prisma.driverProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, isActive: true, accountStatus: true, createdAt: true, lastLoginAt: true } },
      },
    });
  }

  async getDriver(id: string) {
    const driver = await this.findDriverByIdOrUserId(id);
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    return this.prisma.driverProfile.findUnique({
      where: { id: driver.id },
      include: {
        user: {
          include: {
            documents: true,
            driverRides: {
              take: 10,
              orderBy: { createdAt: 'desc' },
              include: {
                passenger: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });
  }

  async suspendDriver(id: string) {
    const driver = await this.findDriverByIdOrUserId(id);
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    await this.prisma.driverProfile.update({ where: { id: driver.id }, data: { adminApproved: false } });
    await this.prisma.user.update({ where: { id: driver.userId }, data: { isActive: false, accountStatus: 'SUSPENDED' } });

    return { message: 'Chauffeur suspendu' };
  }

  async activateDriver(id: string) {
    const driver = await this.findDriverByIdOrUserId(id);
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    await this.prisma.driverProfile.update({ where: { id: driver.id }, data: { adminApproved: true, adminApprovedAt: new Date() } });
    await this.prisma.user.update({ where: { id: driver.userId }, data: { isActive: true, accountStatus: 'ACTIVE', isVerified: true } });

    return { message: 'Chauffeur activé' };
  }

  async approveOrRejectDriver(id: string, approved: boolean, adminNotes?: string) {
    const driver = await this.findDriverByIdOrUserId(id);
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        adminApproved: approved,
        adminApprovedAt: approved ? new Date() : null,
        adminNotes: adminNotes ?? null,
      },
    });

    await this.prisma.user.update({
      where: { id: driver.userId },
      data: {
        accountStatus: approved ? 'ACTIVE' : 'REJECTED',
        isActive: approved,
        isVerified: approved,
      },
    });

    if (approved) {
      try {
        await this.mail.sendDriverApproved(
          driver.user.email,
          driver.user.firstName ?? 'Chauffeur',
        );
      } catch (e: any) {
        this.logger.warn(`Email d'approbation non envoyé: ${e?.message || e}`);
      }
    }

    this.logger.log(
      `[Driver] ${driver.userId} ${approved ? '✅ ACTIVÉ' : '❌ REJETÉ'} par admin`,
    );

    return { message: approved ? 'Dossier approuvé' : 'Dossier rejeté', adminNotes };
  }

  // ─── Documents ─────────────────────────────────────────────────────────────
  async getAllDocuments(status?: string) {
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const docs = await this.prisma.document.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return docs.map((d) => this.mapDocumentForAdmin(d));
  }

  /**
   * 🔧 FIX : après approbation d'un document, on vérifie si TOUS les docs requis
   * du chauffeur sont approuvés. Si oui → activation automatique du compte.
   * (avant, l'admin devait approuver les docs ET activer le chauffeur manuellement)
   */
  async approveDocument(id: string, adminId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document introuvable');

    await this.prisma.document.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: adminId },
    });

    await this.maybeAutoActivateDriver(doc.userId);
    this.emitDocumentUpdated(id, 'APPROVED', doc.userId);

    return { message: 'Document approuvé' };
  }

  async rejectDocument(id: string, adminId: string, reason?: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document introuvable');

    await this.prisma.document.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason ?? null,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });
    this.emitDocumentUpdated(id, 'REJECTED', doc.userId);
    return { message: 'Document rejeté', reason };
  }

  /**
   * Active automatiquement le compte chauffeur si tous les documents requis
   * sont approuvés ET que le compte n'est pas déjà activé.
   */
  private async maybeAutoActivateDriver(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true, documents: true },
    });

    if (!user || !user.driverProfile) return;

    const allRequiredApproved = REQUIRED_DRIVER_DOCS.every((r) =>
      user.documents.some(
        (d) => d.type === r && d.status === DocumentStatus.APPROVED,
      ),
    );

    if (!allRequiredApproved) {
      this.logger.log(`[Driver ${userId}] Pas encore tous les documents requis approuvés.`);
      return;
    }

    if (user.driverProfile.adminApproved && user.accountStatus === 'ACTIVE') {
      return; // déjà actif
    }

    await this.prisma.driverProfile.update({
      where: { id: user.driverProfile.id },
      data: { adminApproved: true, adminApprovedAt: new Date() },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'ACTIVE', isActive: true, isVerified: true },
    });

    this.logger.log(`[Driver ${userId}] ✅ Auto-activé (tous documents approuvés)`);

    try {
      await this.mail.sendDriverApproved(
        user.email,
        user.firstName ?? 'Chauffeur',
      );
    } catch (e: any) {
      this.logger.warn(`Email d'approbation non envoyé: ${e?.message || e}`);
    }
  }

  // ─── Passagers ─────────────────────────────────────────────────────────────
  async getAllPassengers() {
    return this.prisma.user.findMany({
      where: { role: 'PASSENGER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { passengerRides: true } },
      },
    });
  }

  async suspendPassenger(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { message: 'Passager suspendu' };
  }

  async activatePassenger(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: true } });
    return { message: 'Passager activé' };
  }

  // ─── Courses ───────────────────────────────────────────────────────────────
  async getAllRides(limit = 50) {
    return this.prisma.ride.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { firstName: true, lastName: true, email: true } },
        driver: { select: { firstName: true, lastName: true } },
        payment: true,
      },
    });
  }

  async getActiveRides() {
    return this.prisma.ride.findMany({
      where: {
        status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { firstName: true, lastName: true } },
        driver: { select: { firstName: true, lastName: true } },
      },
    });
  }

  // ─── Finances ──────────────────────────────────────────────────────────────
  async getFinanceStats() {
    const [totalRevenue, todayRevenue, weekRevenue, monthRevenue] = await Promise.all([
      this.prisma.ride.aggregate({ _sum: { finalPrice: true }, where: { status: 'COMPLETED' } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return {
      total: totalRevenue._sum.finalPrice ?? 0,
      today: todayRevenue._sum.finalPrice ?? 0,
      week: weekRevenue._sum.finalPrice ?? 0,
      month: monthRevenue._sum.finalPrice ?? 0,
    };
  }

  async getFinanceChart(period: 'daily' | 'weekly' | 'monthly' = 'weekly') {
    const days = period === 'daily' ? 7 : period === 'weekly' ? 4 : 12;
    const data = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const result = await this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        _count: { id: true },
        where: { status: 'COMPLETED', completedAt: { gte: start, lte: end } },
      });

      data.push({
        date: start.toISOString().split('T')[0],
        revenue: result._sum.finalPrice ?? 0,
        rides: result._count.id ?? 0,
      });
    }

    return data;
  }

  async getFinanceTransactions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.ride.findMany({
        skip,
        take: limit,
        where: { status: 'COMPLETED', finalPrice: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          finalPrice: true,
          paymentMethod: true,
          completedAt: true,
          passenger: { select: { firstName: true, lastName: true } },
          driver: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.ride.count({ where: { status: 'COMPLETED', finalPrice: { not: null } } }),
    ]);

    return { transactions, total, page, limit };
  }

  // ─── Simulateur de prix (config admin persistée) ───────────────────────────
  async estimatePrice(params: {
    distanceKm: number;
    durationMin: number;
    vehicleType: string;
    zone?: string;
    pickupLat?: number;
    pickupLng?: number;
    demandLevel?: string;
  }) {
    const pricing = await this.platformConfig.getPricing();
    const financials = await this.platformConfig.getFinancials();
    const estimate = await this.platformConfig.calculatePriceWithZones({
      distanceKm: params.distanceKm,
      durationMin: params.durationMin,
      vehicleType: params.vehicleType,
      pickupLat: params.pickupLat,
      pickupLng: params.pickupLng,
      zone: params.zone,
      demandLevel: params.demandLevel,
    });

    const vt = (params.vehicleType || 'ECO').toUpperCase();
    const tarifKm = pricing.pricePerKm[vt] ?? pricing.pricePerKm['ECO'] ?? 1.2;
    const platformPct =
      (Number(financials.platformCommission) || 20) / 100;

    return {
      estimate,
      currency: pricing.currency,
      breakdown: {
        priseEnCharge: pricing.pickupFee,
        prixDistance: Math.round(params.distanceKm * tarifKm * 100) / 100,
        prixTemps: Math.round(params.durationMin * pricing.pricePerMinute * 100) / 100,
      },
      split: {
        chauffeur: Math.round(estimate * (1 - platformPct) * 100) / 100,
        plateforme: Math.round(estimate * platformPct * 100) / 100,
      },
    };
  }
}