// src/documents/documents.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

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
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,   // ← Injection Cloudinary
  ) {}

  private parseDocType(type: string): DocumentType {
    // Mapping des types envoyés par Flutter vers les types Prisma
    const TYPE_MAP: Record<string, DocumentType> = {
      license:           DocumentType.DRIVERS_LICENSE,
      drivers_license:   DocumentType.DRIVERS_LICENSE,
      gray_card:         DocumentType.VEHICLE_REGISTRATION,
      vehicle_registration: DocumentType.VEHICLE_REGISTRATION,
      insurance:         DocumentType.INSURANCE,
      technical_control: DocumentType.TECHNICAL_CONTROL,
      id_card_front:     DocumentType.ID_CARD_FRONT,
      id_card_back:      DocumentType.ID_CARD_BACK,
      selfie_with_id:    DocumentType.SELFIE_WITH_ID,
    };

    const normalized = (type || '').toLowerCase().trim();
    if (TYPE_MAP[normalized]) return TYPE_MAP[normalized];

    // Fallback: essai direct avec la valeur uppercase
    const val = (DocumentType as any)[(type || '').toUpperCase()];
    if (!val) throw new BadRequestException(`Type de document invalide: ${type}`);
    return val;
  }

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
      docs.some((d) => d.type === r && d.status === DocumentStatus.APPROVED)
    );
  }

  /**
   * Upload d'un document via base64 vers Cloudinary
   */
  async uploadBase64Document(params: { 
    userId: string; 
    type: string; 
    imageBase64: string 
  }) {
    const { userId, type, imageBase64 } = params;

    if (!imageBase64 || imageBase64.length < 100) 
      throw new BadRequestException('Image invalide');

    const docType = this.parseDocType(type);

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
    const uploadResult = await this.cloudinaryService.uploadImage(
      dataUri,
      folder
    );

    // Sauvegarde dans la base de données
    const document = await this.prisma.document.create({
      data: {
        userId,
        type: docType,
        fileUrl: uploadResult.url,           // URL Cloudinary[](https://res.cloudinary.com/...)
        publicId: uploadResult.publicId,     // Important pour suppression future
        status: DocumentStatus.PENDING,
      },
    });

    // Mise à jour du profil chauffeur (uniquement si le profil existe déjà)
    await this.prisma.driverProfile.updateMany({
      where: { userId },
      data: { 
        documentsUploaded: true, 
        documentsUploadedAt: new Date(),
      },
    }).catch(() => undefined);

    return {
      success: true,
      message: 'Document envoyé avec succès sur Cloudinary',
      documentId: document.id,
      fileUrl: uploadResult.url,
      publicId: uploadResult.publicId,
      type: docType,
      status: document.status,
    };
  }

  // === Méthodes d'administration (inchangées sauf mapDoc simplifié) ===

  private mapDoc<T extends { fileUrl: string; publicId?: string; user?: any }>(doc: T) {
    return {
      ...doc,
      url: doc.fileUrl,                    // Cloudinary renvoie déjà une URL complète
      uploaderName: doc.user?.firstName || doc.user?.email || 'Inconnu',
      uploaderEmail: doc.user?.email ?? null,
      uploaderId: doc.user?.id ?? null,
    };
  }

  async listPendingDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.PENDING },
      include: { user: { select: { id: true, email: true, firstName: true, role: true, accountStatus: true } } },
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
    rejectionReason?: string 
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
        rejectionReason: targetStatus === DocumentStatus.REJECTED 
          ? (rejectionReason ?? 'Document non conforme') 
          : null,
      },
    });

    await this.refreshDriverState(doc.userId);
    
    return { 
      success: true, 
      message: targetStatus === DocumentStatus.APPROVED 
        ? 'Document approuvé ✅' 
        : 'Document rejeté ❌', 
      document: reviewed 
    };
  }

  // Validation finale du chauffeur (très stricte comme tu le souhaites)
  async decideDriverAccount(params: { 
    driverId: string; 
    adminId: string; 
    approved: boolean; 
    adminNotes?: string 
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
      if (!user.driverProfile.faceVerified) 
        throw new BadRequestException('La vérification faciale est obligatoire');

      if (!user.driverProfile.vehicleMake || 
          !user.driverProfile.vehicleModel || 
          !user.driverProfile.licensePlate) {
        throw new BadRequestException('Les informations du véhicule doivent être complètes');
      }

      if (!this.hasAllRequired(user.documents)) {
        throw new BadRequestException(
          'Tous les documents requis doivent être approuvés (ID recto/verso, selfie avec pièce, permis, carte grise, assurance)'
        );
      }
    }

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: { 
        adminApproved: approved, 
        adminApprovedAt: approved ? new Date() : null, 
        adminNotes: adminNotes ?? null 
      },
    });

    await this.prisma.user.update({
      where: { id: driverId },
      data: { 
        accountStatus: approved ? 'ACTIVE' : 'REJECTED', 
        isVerified: approved 
      },
    });

    return { 
      success: true, 
      message: approved ? 'Compte chauffeur validé ✅' : 'Compte chauffeur rejeté ❌' 
    };
  }

  private async refreshDriverState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true, documents: true },
    });

    if (!user || user.role !== 'DRIVER' || !user.driverProfile) return;

    const allApproved = this.hasAllRequired(user.documents);
    const hasVehicle = !!(user.driverProfile.vehicleMake && 
                         user.driverProfile.vehicleModel && 
                         user.driverProfile.licensePlate);
    const faceOk = !!user.driverProfile.faceVerified;

    if (allApproved && hasVehicle && faceOk) {
      await this.prisma.driverProfile.update({
        where: { userId },
        data: { adminApproved: true, adminApprovedAt: new Date() }
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'ACTIVE', isVerified: true }
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'ADMIN_REVIEW_PENDING' }
      }).catch(() => {});
    }
  }
}