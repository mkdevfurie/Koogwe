// src/documents/documents.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { parseDocType } from '../common/utils';

const REQUIRED_DRIVER_DOCS: DocumentType[] = [
  DocumentType.ID_CARD_FRONT,
  DocumentType.ID_CARD_BACK,
  DocumentType.SELFIE_WITH_ID,
  DocumentType.DRIVERS_LICENSE,
  DocumentType.VEHICLE_REGISTRATION,
  DocumentType.INSURANCE,
];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  private toDocStatus(status?: string, approved?: boolean): DocumentStatus {
    if (typeof approved === 'boolean')
      return approved ? DocumentStatus.APPROVED : DocumentStatus.REJECTED;
    const n = (status || '').toUpperCase();
    if (['APPROVED', 'APPROVE', 'VALIDATED'].includes(n)) return DocumentStatus.APPROVED;
    if (['REJECTED', 'REJECT', 'REFUSED'].includes(n)) return DocumentStatus.REJECTED;
    throw new BadRequestException('Status doit être APPROVED ou REJECTED');
  }

  private hasAllRequired(docs: Array<{ type: DocumentType; status: DocumentStatus }>) {
    return REQUIRED_DRIVER_DOCS.every((r) =>
      docs.some((d) => d.type === r && d.status === DocumentStatus.APPROVED),
    );
  }

  /**
   * 🚨 MODE BYPASS CLOUDINARY 🚨
   * Stocke le document directement en base sous forme de data URI base64.
   * À remettre sur Cloudinary plus tard.
   */
  async uploadBase64Document(params: {
    userId: string;
    type: string;
    imageBase64: string;
  }) {
    const { userId, type, imageBase64 } = params;

    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      throw new BadRequestException('Image invalide ou manquante');
    }

    const docType = parseDocType(type);

    // Décode pour valider et mesurer
    const cleanBase64 = imageBase64.replace(/^data:[\w/+.-]+;base64,/, '').trim();
    let buffer: Buffer;
    try {
      buffer = Buffer.from(cleanBase64, 'base64');
    } catch {
      throw new BadRequestException('Image base64 corrompue');
    }

    if (buffer.byteLength === 0) {
      throw new BadRequestException('Image vide après décodage');
    }
    if (buffer.byteLength > 8 * 1024 * 1024) {
      throw new BadRequestException('Document trop volumineux (max 8MB)');
    }

    this.logger.log(
      `📦 [BYPASS-DB] Stockage local du document user=${userId} type=${docType} size=${(buffer.byteLength / 1024).toFixed(0)}KB`,
    );

    // Détecte le type MIME approximatif depuis les premiers octets
    let mime = 'image/jpeg';
    if (buffer.length >= 4) {
      const sig = buffer.slice(0, 4).toString('hex');
      if (sig.startsWith('89504e47')) mime = 'image/png';
      else if (sig.startsWith('25504446')) mime = 'application/pdf';
      else if (sig.startsWith('ffd8ff')) mime = 'image/jpeg';
      else if (sig.startsWith('47494638')) mime = 'image/gif';
    }

    // On stocke la data URI directement dans fileUrl
    const dataUri = `data:${mime};base64,${cleanBase64}`;

    let document;
    try {
      document = await this.prisma.document.create({
        data: {
          userId,
          type: docType,
          fileUrl: dataUri,
          publicId: `local_${Date.now()}_${userId}`,
          status: DocumentStatus.PENDING,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `[uploadBase64Document] DB create failed user=${userId}: ${error?.message || error}`,
      );
      throw error;
    }

    await this.prisma.driverProfile
      .updateMany({
        where: { userId },
        data: {
          documentsUploaded: true,
          documentsUploadedAt: new Date(),
        },
      })
      .catch((err) => {
        this.logger.warn(
          `[uploadBase64Document] DriverProfile update échoué user=${userId}: ${err?.message || err}`,
        );
      });

    this.logger.log(`✅ Document enregistré: ${document.id} (type=${docType})`);

    return {
      success: true,
      message: 'Document envoyé avec succès',
      documentId: document.id,
      fileUrl: document.fileUrl,
      publicId: document.publicId,
      type: docType,
      status: document.status,
    };
  }

  private mapDoc<T extends { fileUrl: string; publicId?: string; user?: any }>(doc: T) {
    return {
      ...doc,
      url: doc.fileUrl,
      uploaderName: doc.user?.firstName || doc.user?.email || 'Inconnu',
      uploaderEmail: doc.user?.email ?? null,
      uploaderId: doc.user?.id ?? null,
    };
  }

  async listPendingDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.PENDING },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            role: true,
            accountStatus: true,
          },
        },
      },
      orderBy: { uploadedAt: 'asc' },
    });
    return docs.map((d) => this.mapDoc(d));
  }

  async listApprovedDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.APPROVED },
      include: { user: { select: { id: true, email: true, firstName: true, role: true } } },
      orderBy: { reviewedAt: 'desc' },
      take: 300,
    });
    return docs.map((d) => this.mapDoc(d));
  }

  async getDocumentsByStatus(status?: string) {
    const n = (status || '').toUpperCase();
    if (n === 'APPROVED') return this.listApprovedDocuments();
    if (n === 'REJECTED') {
      const docs = await this.prisma.document.findMany({
        where: { status: DocumentStatus.REJECTED },
        include: { user: { select: { id: true, email: true, firstName: true, role: true } } },
        orderBy: { reviewedAt: 'desc' },
        take: 300,
      });
      return docs.map((d) => this.mapDoc(d));
    }
    return this.listPendingDocuments();
  }

  async reviewDocument(params: {
    documentId: string;
    adminId: string;
    status?: string;
    approved?: boolean;
    rejectionReason?: string;
  }) {
    const { documentId, adminId, status, approved, rejectionReason } = params;
    const targetStatus = this.toDocStatus(status, approved);

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document introuvable');

    const reviewed = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: targetStatus,
        reviewedAt: new Date(),
        reviewedBy: adminId,
        rejectionReason:
          targetStatus === DocumentStatus.REJECTED
            ? rejectionReason ?? 'Document non conforme'
            : null,
      },
    });

    await this.refreshDriverState(doc.userId);

    return {
      success: true,
      message:
        targetStatus === DocumentStatus.APPROVED
          ? 'Document approuvé ✅'
          : 'Document rejeté ❌',
      document: reviewed,
    };
  }

  async decideDriverAccount(params: {
    driverId: string;
    adminId: string;
    approved: boolean;
    adminNotes?: string;
  }) {
    const { driverId, approved, adminNotes } = params;

    const user = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { driverProfile: true, documents: true },
    });

    if (!user || user.role !== 'DRIVER' || !user.driverProfile)
      throw new NotFoundException('Chauffeur introuvable');

    if (approved) {
      if (!user.driverProfile.faceVerified || !this.hasAllRequired(user.documents)) {
        this.logger.warn(
          `[BYPASS] Activation manuelle du chauffeur ${driverId} sans tous les documents ou face-id.`,
        );
      }
      if (!user.driverProfile.vehicleMake || !user.driverProfile.licensePlate) {
        await this.prisma.driverProfile.update({
          where: { userId: driverId },
          data: {
            vehicleMake: user.driverProfile.vehicleMake || 'Véhicule',
            vehicleModel: user.driverProfile.vehicleModel || 'Test',
            licensePlate: user.driverProfile.licensePlate || 'TEST-MODE',
          },
        });
      }
    }

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: {
        adminApproved: approved,
        adminApprovedAt: approved ? new Date() : null,
        adminNotes: adminNotes ?? null,
      },
    });

    await this.prisma.user.update({
      where: { id: driverId },
      data: {
        accountStatus: approved ? 'ACTIVE' : 'REJECTED',
        isVerified: approved,
      },
    });

    return {
      success: true,
      message: approved ? 'Compte chauffeur validé ✅' : 'Compte chauffeur rejeté ❌',
    };
  }

  private async refreshDriverState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true, documents: true },
    });
    if (!user || user.role !== 'DRIVER' || !user.driverProfile) return;

    const allApproved = this.hasAllRequired(user.documents);
    const hasVehicle = !!(
      user.driverProfile.vehicleMake &&
      user.driverProfile.vehicleModel &&
      user.driverProfile.licensePlate
    );
    const faceOk = !!user.driverProfile.faceVerified;

    if (allApproved && hasVehicle && faceOk) {
      await this.prisma.driverProfile.update({
        where: { userId },
        data: { adminApproved: true, adminApprovedAt: new Date() },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'ACTIVE', isVerified: true },
      });
    }
  }
}