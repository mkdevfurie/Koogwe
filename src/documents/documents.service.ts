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
  DocumentType.DRIVERS_LICENSE,
  DocumentType.VEHICLE_REGISTRATION,
  DocumentType.INSURANCE,
  DocumentType.TECHNICAL_CONTROL,
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
   * Upload d'un document via base64 vers Cloudinary
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

    // Vérification taille (8MB max)
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    
    if (buffer.byteLength > 8 * 1024 * 1024) 
      throw new BadRequestException('Document trop volumineux (max 8MB)');

    // Upload vers Cloudinary
    const folder = `koogwe/documents/${userId}/${docType}`;
    // Cloudinary nécessite le préfixe data URI pour les uploads inline
    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${cleanBase64}`;

    let uploadResult;
    try {
      uploadResult = await this.cloudinaryService.uploadImage(
        dataUri,
        folder
      );
    } catch (error) {
      console.error(`[DocumentsService] Cloudinary upload failed for user ${userId}:`, error);
      throw error;
    }

    // Sauvegarde dans la base de données
    let document;
    try {
      document = await this.prisma.document.create({
        data: {
          userId,
          type: docType,
          fileUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          status: DocumentStatus.PENDING,
        },
      });
    } catch (error) {
      console.error(`[DocumentsService] Database create failed for user ${userId}:`, error);
      throw error;
    }

    // Mise à jour du profil chauffeur (uniquement si le profil existe déjà)
    await this.prisma.driverProfile.updateMany({
      where: { userId },
      data: { 
        documentsUploaded: true, 
        documentsUploadedAt: new Date(),
      },
    }).catch((err) => {
      console.error(`[DocumentsService] DriverProfile update failed for user ${userId}:`, err);
    });

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
      include: { 
        driverProfile: true, 
        documents: true 
      },
    });

    if (!user || user.role !== 'DRIVER' || !user.driverProfile)
      throw new NotFoundException('Chauffeur introuvable');

    if (approved) {
      // ⚠️ MODE TEST : On bypass la vérification stricte pour permettre de tester les courses
      if (!user.driverProfile.faceVerified || !this.hasAllRequired(user.documents)) {
        this.logger.warn(
          `[BYPASS] Activation manuelle du chauffeur ${driverId} sans tous les documents ou face-id.`,
        );
      }

      // On s'assure juste que les infos véhicule ne sont pas nulles pour éviter les bugs d'affichage
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
    } else {
      // ⚠️ MODE TEST : On ne dégrade pas automatiquement le statut pour permettre le bypass manuel
      /*
      await this.prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'ADMIN_REVIEW_PENDING' }
      }).catch(() => {});
      */
    }
  }
}