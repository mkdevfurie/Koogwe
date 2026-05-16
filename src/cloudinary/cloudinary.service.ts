import { Injectable, BadGatewayException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
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