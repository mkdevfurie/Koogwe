import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService) {}

  async validate(code: string, userId: string, userRole: UserRole, basePrice: number) {
    const normalized = code?.trim().toUpperCase();
    if (!normalized) throw new BadRequestException('Code promo requis');

    const promo = await this.prisma.promoCode.findUnique({ where: { code: normalized } });
    if (!promo || !promo.isActive) {
      throw new BadRequestException('Code promo invalide ou expiré');
    }

    const now = new Date();
    if (promo.validFrom && promo.validFrom > now) {
      throw new BadRequestException('Code promo pas encore actif');
    }
    if (promo.validUntil && promo.validUntil < now) {
      throw new BadRequestException('Code promo expiré');
    }
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      throw new BadRequestException('Code promo épuisé');
    }
    if (promo.targetRole && promo.targetRole !== userRole) {
      throw new BadRequestException('Code promo non valable pour votre type de compte');
    }

    const applied = this.applyDiscount(basePrice, promo.discountType, promo.discountValue);
    return {
      valid: true,
      promoId: promo.id,
      code: promo.code,
      label: promo.label,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      ...applied,
    };
  }

  applyDiscount(basePrice: number, discountType: 'PERCENT' | 'FIXED', discountValue: number) {
    let discountAmount =
      discountType === 'PERCENT'
        ? Math.round(basePrice * (discountValue / 100) * 100) / 100
        : Math.min(discountValue, basePrice);
    discountAmount = Math.max(0, discountAmount);
    const finalPrice = Math.max(0, Math.round((basePrice - discountAmount) * 100) / 100);
    return { basePrice, discountAmount, finalPrice };
  }

  async redeem(promoId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id: promoId } });
    if (!promo) throw new NotFoundException('Code promo introuvable');
    return this.prisma.promoCode.update({
      where: { id: promoId },
      data: { usedCount: { increment: 1 } },
    });
  }
}
