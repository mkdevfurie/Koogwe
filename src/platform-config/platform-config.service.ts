import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SETTINGS_ID = 'default';

export type PricingConfig = {
  baseFare: number;
  pickupFee: number;
  minimumFare: number;
  pricePerMinute: number;
  pricePerKm: Record<string, number>;
  surgeMultiplier: number;
  currency: string;
};

export type PlatformOpsConfig = {
  appName: string;
  supportEmail: string;
  maintenanceMode: boolean;
  registrationOpen: boolean;
  driverAutoApproval: boolean;
  maxDriversOnline: number;
  driverSearchRadiusKm: number;
};

export type PaymentsConfig = {
  stripeEnabled: boolean;
  cashEnabled: boolean;
  walletEnabled: boolean;
  paypalEnabled: boolean;
  mobileMoneyEnabled: boolean;
};

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

@Injectable()
export class PlatformConfigService {
  private readonly logger = new Logger(PlatformConfigService.name);
  private cache: Awaited<ReturnType<typeof this.loadRow>> | null = null;
  private cacheAt = 0;
  private readonly cacheTtlMs = 30_000;

  constructor(private prisma: PrismaService) {}

  private defaultPricing(): PricingConfig {
    return {
      baseFare: Number(process.env.PRICING_BASE_FARE ?? 4),
      pickupFee: Number(process.env.PRICING_PICKUP_FEE ?? 3),
      minimumFare: Number(process.env.PRICING_MIN_PRICE ?? 7),
      pricePerMinute: Number(process.env.PRICING_MINUTE_RATE ?? 0.3),
      pricePerKm: {
        MOTO: Number(process.env.PRICING_KM_MOTO ?? 1.0),
        ECO: Number(process.env.PRICING_KM_ECO ?? 1.2),
        CONFORT: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
        VAN: Number(process.env.PRICING_KM_VAN ?? 1.9),
        BERLINE: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
        SUV: Number(process.env.PRICING_KM_VAN ?? 1.9),
        LUXE: Number(process.env.PRICING_KM_LUXE ?? 2.5),
      },
      surgeMultiplier: Number(process.env.PRICING_MAX_SURGE ?? 3),
      currency: 'EUR',
    };
  }

  private defaultPlatform(): PlatformOpsConfig {
    return {
      appName: 'KOOGWE',
      supportEmail: 'support@koogwe.com',
      maintenanceMode: false,
      registrationOpen: true,
      driverAutoApproval: false,
      maxDriversOnline: 500,
      driverSearchRadiusKm: Number(process.env.DRIVER_SEARCH_RADIUS_KM ?? 30),
    };
  }

  private defaultPayments(): PaymentsConfig {
    return {
      stripeEnabled: true,
      cashEnabled: true,
      walletEnabled: true,
      paypalEnabled: (process.env.PAYPAL_ENABLED ?? 'false').toLowerCase() === 'true',
      mobileMoneyEnabled: false,
    };
  }

  private merge<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
    if (!stored || typeof stored !== 'object') return defaults;
    return { ...defaults, ...(stored as Record<string, unknown>) } as T;
  }

  private async loadRow() {
    let row = await this.prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row) {
      row = await this.prisma.platformSettings.create({
        data: {
          id: SETTINGS_ID,
          pricing: this.defaultPricing() as object,
          financials: {
            driverShare: 80,
            platformCommission: 20,
            currency: 'EUR',
            minWithdrawal: 20,
            withdrawalFee: 0,
            autoTransfer: true,
            escrowEnabled: true,
          },
          payments: this.defaultPayments() as object,
          security: {
            jwtTtlMinutes: 60,
            refreshTtlDays: 30,
            geofencingEnabled: true,
            sosEnabled: true,
            anomalyDetection: true,
            auditLogs: true,
            twoFactor: false,
            ipWhitelist: false,
          },
          platform: this.defaultPlatform() as object,
        },
      });
    }
    return row;
  }

  private async getRow() {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.cacheTtlMs) return this.cache;
    this.cache = await this.loadRow();
    this.cacheAt = now;
    return this.cache;
  }

  private invalidateCache() {
    this.cache = null;
    this.cacheAt = 0;
  }

  async getPricing(): Promise<PricingConfig> {
    const row = await this.getRow();
    return this.merge(this.defaultPricing(), row.pricing);
  }

  async updatePricing(patch: Partial<PricingConfig>) {
    const current = await this.getPricing();
    const next = { ...current, ...patch };
    if (patch.pricePerKm) {
      next.pricePerKm = { ...current.pricePerKm, ...patch.pricePerKm };
    }
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, pricing: next as object },
      update: { pricing: next as object },
    });
    this.invalidateCache();
    return next;
  }

  async getPlatform(): Promise<PlatformOpsConfig> {
    const row = await this.getRow();
    return this.merge(this.defaultPlatform(), row.platform);
  }

  async updatePlatform(patch: Partial<PlatformOpsConfig>) {
    const current = await this.getPlatform();
    const next = { ...current, ...patch };
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, platform: next as object },
      update: { platform: next as object },
    });
    this.invalidateCache();
    return next;
  }

  async getDriverSearchRadiusKm(): Promise<number> {
    const p = await this.getPlatform();
    const r = Number(p.driverSearchRadiusKm);
    return Number.isFinite(r) && r > 0 ? r : 30;
  }

  async getPayments(): Promise<PaymentsConfig> {
    const row = await this.getRow();
    return this.merge(this.defaultPayments(), row.payments);
  }

  async updatePayments(patch: Partial<PaymentsConfig>) {
    const current = await this.getPayments();
    const next = { ...current, ...patch };
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, payments: next as object },
      update: { payments: next as object },
    });
    this.invalidateCache();
    return next;
  }

  async getFinancials() {
    const row = await this.getRow();
    const defaults = {
      driverShare: 80,
      platformCommission: 20,
      currency: 'EUR',
      minWithdrawal: 20,
      withdrawalFee: 0,
      autoTransfer: true,
      escrowEnabled: true,
    };
    return this.merge(defaults, row.financials);
  }

  async updateFinancials(patch: Record<string, unknown>) {
    const current = await this.getFinancials();
    const next = { ...current, ...patch };
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, financials: next as object },
      update: { financials: next as object },
    });
    this.invalidateCache();
    return next;
  }

  async getSecurity() {
    const row = await this.getRow();
    const defaults = {
      jwtTtlMinutes: 60,
      refreshTtlDays: 30,
      geofencingEnabled: true,
      sosEnabled: true,
      anomalyDetection: true,
      auditLogs: true,
      twoFactor: false,
      ipWhitelist: false,
      otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
    };
    return this.merge(defaults, row.security);
  }

  async updateSecurity(patch: Record<string, unknown>) {
    const current = await this.getSecurity();
    const next = { ...current, ...patch };
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, security: next as object },
      update: { security: next as object },
    });
    this.invalidateCache();
    return next;
  }

  async getPublicAppConfig() {
    const [pricing, payments, platform] = await Promise.all([
      this.getPricing(),
      this.getPayments(),
      this.getPlatform(),
    ]);
    return {
      maintenanceMode: platform.maintenanceMode,
      registrationOpen: platform.registrationOpen,
      driverSearchRadiusKm: platform.driverSearchRadiusKm,
      payments,
      pricing: {
        currency: pricing.currency,
        minimumFare: pricing.minimumFare,
      },
    };
  }

  /** Coefficient surge si le point est dans une zone chaude active */
  async getHotZoneSurgeAt(lat: number, lng: number): Promise<number> {
    const zones = await this.prisma.hotZone.findMany({ where: { isActive: true } });
    let maxSurge = 1;
    for (const z of zones) {
      const d = haversineKm(lat, lng, z.centerLat, z.centerLng);
      if (d <= z.radiusKm) {
        maxSurge = Math.max(maxSurge, z.surgeMultiplier);
      }
    }
    return maxSurge;
  }

  calculatePrice(params: {
    distanceKm: number;
    durationMin: number;
    vehicleType: string;
    pickupLat?: number;
    pickupLng?: number;
    zone?: string;
    timeOfDay?: string;
    trafficLevel?: string;
    weatherCondition?: string;
    demandLevel?: string;
  }, pricing?: PricingConfig, hotSurge = 1): number {
    const p = pricing ?? this.defaultPricing();
    const vt = (params.vehicleType || 'ECO').toUpperCase();
    const tarifKm = p.pricePerKm[vt] ?? p.pricePerKm['ECO'] ?? 1.2;

    const prixBase =
      p.pickupFee + params.distanceKm * tarifKm + params.durationMin * p.pricePerMinute;

    const hour = new Date().getHours();
    let coeffHoraire = 1.0;
    if (hour >= 7 && hour <= 9) coeffHoraire = 1.3;
    if (hour >= 17 && hour <= 20) coeffHoraire = 1.3;
    if (hour >= 22 || hour <= 5) coeffHoraire = 1.4;

    const coeffZone: Record<string, number> = {
      normal: 1.0, centre: 1.15, aeroport: 1.3, rural: 0.9,
    };
    const coeffDemande: Record<string, number> = {
      normale: 1.0, forte: 1.2, tres_forte: 1.5, critique: 2.0,
    };

    const cZone = coeffZone[params.zone ?? 'normal'] ?? 1.0;
    const cDemande = coeffDemande[params.demandLevel ?? 'normale'] ?? 1.0;
    const surgeCap = Math.min(p.surgeMultiplier, hotSurge * cDemande);

    const prixFinal = Math.max(
      prixBase * coeffHoraire * cZone * surgeCap,
      p.minimumFare,
    );
    return Math.round(prixFinal * 100) / 100;
  }

  async calculatePriceWithZones(params: {
    distanceKm: number;
    durationMin: number;
    vehicleType: string;
    pickupLat?: number;
    pickupLng?: number;
    zone?: string;
    demandLevel?: string;
  }) {
    const pricing = await this.getPricing();
    let hotSurge = 1;
    if (params.pickupLat != null && params.pickupLng != null) {
      hotSurge = await this.getHotZoneSurgeAt(params.pickupLat, params.pickupLng);
    }
    return this.calculatePrice(params, pricing, hotSurge);
  }

  filterDriversByRadius<T extends { currentLat: number | null; currentLng: number | null }>(
    drivers: T[],
    pickupLat: number,
    pickupLng: number,
    radiusKm: number,
  ): T[] {
    return drivers.filter((d) => {
      if (d.currentLat == null || d.currentLng == null) return false;
      return haversineKm(d.currentLat, d.currentLng, pickupLat, pickupLng) <= radiusKm;
    });
  }

  // ─── Hot zones CRUD ───────────────────────────────────────────────────────

  listHotZones() {
    return this.prisma.hotZone.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async createHotZone(data: {
    name: string;
    centerLat: number;
    centerLng: number;
    radiusKm?: number;
    surgeMultiplier?: number;
    isActive?: boolean;
  }) {
    return this.prisma.hotZone.create({
      data: {
        name: data.name,
        centerLat: data.centerLat,
        centerLng: data.centerLng,
        radiusKm: data.radiusKm ?? 2,
        surgeMultiplier: data.surgeMultiplier ?? 1.2,
        isActive: data.isActive ?? true,
      },
    });
  }

  async updateHotZone(
    id: string,
    data: Partial<{
      name: string;
      centerLat: number;
      centerLng: number;
      radiusKm: number;
      surgeMultiplier: number;
      isActive: boolean;
    }>,
  ) {
    const existing = await this.prisma.hotZone.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Zone introuvable');
    return this.prisma.hotZone.update({ where: { id }, data });
  }

  async deleteHotZone(id: string) {
    const existing = await this.prisma.hotZone.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Zone introuvable');
    await this.prisma.hotZone.delete({ where: { id } });
    return { success: true };
  }
}
