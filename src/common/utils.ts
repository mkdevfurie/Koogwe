// src/common/utils.ts
import { BadRequestException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';

export function parseDocType(type: string): DocumentType {
  // Mapping des types envoyés par Flutter vers les types Prisma
  const TYPE_MAP: Record<string, DocumentType> = {
    license:           DocumentType.DRIVERS_LICENSE,
    drivers_license:   DocumentType.DRIVERS_LICENSE,
    gray_card:         DocumentType.VEHICLE_REGISTRATION,
    registration:      DocumentType.VEHICLE_REGISTRATION,
    vehicle_registration: DocumentType.VEHICLE_REGISTRATION,
    insurance:         DocumentType.INSURANCE,
    technical_control: DocumentType.TECHNICAL_CONTROL,
    id_card:           DocumentType.ID_CARD_FRONT, // Par défaut on prend le recto
    id_card_front:     DocumentType.ID_CARD_FRONT,
    id_card_back:      DocumentType.ID_CARD_BACK,
    selfie_with_id:    DocumentType.SELFIE_WITH_ID,
    vtc_card:          DocumentType.TECHNICAL_CONTROL, // Fallback vers Technical Control ou autre si non existant
  };

  const normalized = (type || '').toLowerCase().trim();
  if (TYPE_MAP[normalized]) return TYPE_MAP[normalized];

  // Fallback: essai direct avec la valeur uppercase
  const val = (DocumentType as any)[(type || '').toUpperCase()];
  if (!val) throw new BadRequestException(`Type de document invalide: ${type}`);
  return val;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
