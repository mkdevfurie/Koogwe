import { Injectable, BadGatewayException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    console.log(`[CloudinaryService] Initializing with Cloud Name: ${cloudName}, API Key: ${apiKey?.substring(0, 4)}...`);

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  async uploadImage(
    imageBase64: string,
    folder: string = 'koogwe/documents',
    publicId?: string
  ): Promise<any> {
    try {
      const result = await cloudinary.uploader.upload(imageBase64, {
        folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: true,
      });

      return {
        publicId: result.public_id,
        url: result.secure_url,        // URL HTTPS sécurisée
        width: result.width,
        height: result.height,
      };
    } catch (error) {
      console.error('Cloudinary upload error:', error?.message || error);
      throw new BadGatewayException('Échec de l\'upload sur Cloudinary. Vérifiez vos credentials CLOUDINARY_*');
    }
  }

  async deleteImage(publicId: string) {
    try {
      return await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Cloudinary delete error:', error);
    }
  }
}