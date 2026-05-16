// src/users/users.controller.ts
import {
  Controller, Get, Patch, Post, Delete,
  Body, Param, Req, Query, BadRequestException, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService, UpdateProfileDto, UpdateVehicleDto } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil complet' })
  getMe(@Req() req: any) { return this.usersService.findById(req.user.id); }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mettre à jour le profil (alias)' })
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  // ── Upload avatar via Cloudinary ───────────────────────────────────────────
  // 🔧 FIX : on stocke sur Cloudinary (les fichiers locaux disparaissent sur Railway).
  // L'app passager pointe sur /users/me/avatar via api_constants corrigé.
  // 🔧 FIX : alias pour compatibilité
  @Post('upload-avatar')
  @ApiOperation({ summary: 'Upload photo de profil (base64) - alias' })
  async uploadAvatarAlias(@Req() req: any, @Body() body: { imageBase64: string }) {
    return this.uploadAvatar(req, body);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload photo de profil (base64)' })
  async uploadAvatar(@Req() req: any, @Body() body: { imageBase64: string }) {
    const userId = req.user.id;
    const base64 = body?.imageBase64;
    if (!base64 || typeof base64 !== 'string' || base64.length < 100) {
      throw new BadRequestException('imageBase64 manquant ou invalide');
    }

    // Nettoyage du préfixe data URI (le service Cloudinary l'accepte de toute façon)
    const cleaned = base64.replace(/^data:[\w/+.-]+;base64,/, '').trim();
    let buffer: Buffer;
    try {
      buffer = Buffer.from(cleaned, 'base64');
    } catch {
      throw new BadRequestException('imageBase64 corrompu');
    }
    if (buffer.byteLength === 0) {
      throw new BadRequestException('Image vide');
    }
    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException('Avatar trop volumineux (max 5MB)');
    }

    try {
      const result = await this.cloudinary.uploadImage(
        buffer,
        `koogwe/avatars/${userId}`,
      );
      await this.usersService.updateProfile(userId, { avatarUrl: result.url });
      return { avatarUrl: result.url };
    } catch (e: any) {
      this.logger.error(`[uploadAvatar] échec user=${userId}: ${e?.message || e}`);
      throw e;
    }
  }

  @Patch('vehicle')
  @ApiOperation({ summary: 'Mettre à jour le véhicule (chauffeur)' })
  updateVehicle(@Req() req: any, @Body() dto: UpdateVehicleDto) {
    return this.usersService.updateVehicle(req.user.id, dto);
  }

  @Get('driver-status')
  @ApiOperation({ summary: 'Statut onboarding chauffeur' })
  getDriverStatus(@Req() req: any) { return this.usersService.getDriverStatus(req.user.id); }

  @Post('submit-documents')
  @ApiOperation({ summary: 'Soumettre les documents pour validation admin' })
  submitDocuments(@Req() req: any) { return this.usersService.markDocumentsUploaded(req.user.id); }

  @Get('me/rides')
  @ApiOperation({ summary: 'Historique courses passager (alias)' })
  getHistoryAlias(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 10) {
    return this.getHistory(req, page, limit);
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique courses passager' })
  getHistory(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 10) {
    return this.usersService.getRideHistory(req.user.id, +page, +limit);
  }

  @Get('me/notifications')
  @ApiOperation({ summary: 'Notifications passager (alias)' })
  getNotificationsAlias(@Req() req: any) {
    return this.getNotifications(req);
  }

  @Get('notifications')
  getNotifications(@Req() req: any) { return this.usersService.getNotifications(req.user.id); }

  @Patch('notifications/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.usersService.markNotificationRead(id, req.user.id);
  }

  @Patch('notifications/read-all')
  markAllRead(@Req() req: any) { return this.usersService.markAllNotificationsRead(req.user.id); }

  @Get('saved-places')
  getSavedPlaces(@Req() req: any) { return this.usersService.getSavedPlaces(req.user.id); }

  @Post('saved-places')
  addSavedPlace(@Req() req: any, @Body() dto: any) {
    return this.usersService.addSavedPlace(req.user.id, dto);
  }

  @Delete('saved-places/:id')
  removeSavedPlace(@Req() req: any, @Param('id') id: string) {
    return this.usersService.removeSavedPlace(req.user.id, id);
  }
}