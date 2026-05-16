// src/cloudinary/cloudinary.service.ts
import {
  Injectable,
  Logger,
  BadGatewayException,
  InternalServerErrorException,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import {
  v2 as cloudinary,
  UploadApiErrorResponse,
  UploadApiResponse,
} from 'cloudinary';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;
  private cloudName?: string;

  constructor(private configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    // ───── Logs de diagnostic au démarrage ─────
    this.logger.log('━━━━━━━━━━━━ CLOUDINARY CONFIG ━━━━━━━━━━━━');
    this.logger.log(
      `CLOUDINARY_CLOUD_NAME : ${cloudName ? `"${cloudName}"` : '❌ MANQUANT'}`,
    );
    this.logger.log(
      `CLOUDINARY_API_KEY    : ${apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 2)} (len=${apiKey.length})` : '❌ MANQUANT'}`,
    );
    this.logger.log(
      `CLOUDINARY_API_SECRET : ${apiSecret ? `présent (len=${apiSecret.length})` : '❌ MANQUANT'}`,
    );
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.error(
        '❌ Cloudinary credentials manquants — les uploads vont échouer.',
      );
      this.configured = false;
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
      timeout: 60_000,
    });

    this.cloudName = cloudName;
    this.configured = true;
    this.logger.log(`✅ Cloudinary configuré (cloud: ${cloudName})`);
  }

  /** Décode un base64 (avec ou sans préfixe data URI) en Buffer. */
  private base64ToBuffer(imageBase64: string): Buffer {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new BadRequestException('imageBase64 manquant ou invalide');
    }
    const cleaned = imageBase64.replace(/^data:[\w/+.-]+;base64,/, '').trim();
    if (cleaned.length < 50) {
      throw new BadRequestException('imageBase64 trop court / corrompu');
    }
    try {
      return Buffer.from(cleaned, 'base64');
    } catch {
      throw new BadRequestException('imageBase64 non décodable');
    }
  }

  /**
   * Upload via upload_stream (chunké) — fiable pour les gros base64.
   * Accepte une string base64 (avec/sans data URI) OU directement un Buffer.
   */
  async uploadImage(
    image: string | Buffer,
    folder: string = 'koogwe/documents',
    publicId?: string,
  ): Promise<{
    publicId: string;
    url: string;
    width?: number;
    height?: number;
    bytes?: number;
  }> {
    if (!this.configured) {
      this.logger.error(
        '❌ Tentative d\'upload alors que Cloudinary n\'est pas configuré.',
      );
      throw new InternalServerErrorException(
        'Service de stockage non configuré (credentials Cloudinary manquants côté serveur).',
      );
    }

    const buffer = Buffer.isBuffer(image) ? image : this.base64ToBuffer(image);
    const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2);

    this.logger.log(`📤 Upload Cloudinary → folder="${folder}" size=${sizeMB}MB`);

    // Cloudinary limite l'upload classique à ~10 MB ; on garde une marge.
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new PayloadTooLargeException(
        `Image trop volumineuse (${sizeMB}MB, max 10MB).`,
      );
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'image',
          overwrite: true,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error || !result) {
            const errMsg =
              (error as any)?.message ||
              (error as any)?.error?.message ||
              'unknown error';
            const errCode =
              (error as any)?.http_code || (error as any)?.code || 'N/A';
            const fullErr = JSON.stringify(error || {}, null, 2);

            this.logger.error(
              `❌ Cloudinary upload error [code=${errCode}]: ${errMsg}`,
            );
            this.logger.error(`   Détail brut: ${fullErr}`);

            if (
              errCode === 401 ||
              /invalid api[_ ]key|invalid signature|disable account/i.test(errMsg)
            ) {
              return reject(
                new InternalServerErrorException(
                  `Identifiants Cloudinary invalides ou compte désactivé (cloud=${this.cloudName}). Détail: ${errMsg}`,
                ),
              );
            }
            if (errCode === 420 || /rate limit|quota/i.test(errMsg)) {
              return reject(
                new InternalServerErrorException(
                  `Quota Cloudinary dépassé. Détail: ${errMsg}`,
                ),
              );
            }
            if (errCode === 413 || /too large|payload/i.test(errMsg)) {
              return reject(
                new PayloadTooLargeException(
                  `Image trop volumineuse pour Cloudinary: ${errMsg}`,
                ),
              );
            }
            if (
              errCode === 400 ||
              /invalid image|unsupported|preset/i.test(errMsg)
            ) {
              return reject(
                new BadRequestException(`Image invalide : ${errMsg}`),
              );
            }
            return reject(
              new BadGatewayException(
                `Échec de l'upload sur Cloudinary [${errCode}]: ${errMsg}`,
              ),
            );
          }

          this.logger.log(
            `✅ Upload OK → ${result.secure_url} (${result.bytes} bytes)`,
          );
          resolve({
            publicId: result.public_id,
            url: result.secure_url,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
          });
        },
      );

      Readable.from(buffer).pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (error: any) {
      this.logger.warn(
        `Cloudinary delete error pour ${publicId}: ${error?.message || error}`,
      );
    }
  }
}
