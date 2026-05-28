// src/drivers/drivers.controller.ts
import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { FaceVerificationService } from '../face-verification/face-verification.service';
import { Roles, RolesGuard, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@ApiTags('Drivers')
@ApiBearerAuth()
@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly faceVerificationService: FaceVerificationService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Post('profile')
  @ApiOperation({ summary: 'Créer ou mettre à jour le profil chauffeur' })
  createProfile(@Req() req: any, @Body() dto: any) {
    return this.driversService.createProfile(req.user.id, dto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Obtenir son profil chauffeur' })
  getProfile(@Req() req: any) {
    return this.driversService.getProfile(req.user.id);
  }

  @Patch('bank-account')
  @ApiOperation({ summary: 'Enregistrer le RIB du chauffeur (retraits)' })
  updateBankAccount(
    @Req() req: any,
    @Body() body: { bankAccountHolder?: string; bankIban?: string; bankBic?: string },
  ) {
    return this.driversService.updateBankAccount(req.user.id, body);
  }

  @Get('bank-account')
  @ApiOperation({ summary: 'Lire le RIB enregistré' })
  getBankAccount(@Req() req: any) {
    return this.driversService.getBankAccount(req.user.id);
  }

  // 🔧 FIX : route /verify-face supprimée (doublon avec FaceVerificationController)
  @Get('face-status')
  @ApiOperation({ summary: 'Statut vérification faciale' })
  async getFaceStatus(@Req() req: any) {
    return this.faceVerificationService.getFaceVerificationStatus(req.user.id);
  }

  @Patch('availability')
  updateAvailability(@Req() req: any, @Body() dto: any) {
    return this.driversService.updateAvailability(req.user.id, dto);
  }

  @Patch('location')
  updateLocation(@Req() req: any, @Body() dto: any) {
    return this.driversService.updateLocation(req.user.id, dto);
  }

  @Get('stats')
  getStats(@Req() req: any) {
    return this.driversService.getStats(req.user.id);
  }

  @Get('rides')
  getRides(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '10') {
    return this.driversService.getRideHistory(req.user.id, +page, +limit);
  }

  // 🔧 FIX : utilise file.buffer (mémoire) au lieu de file.path
  @Post('documents')
  @ApiOperation({ summary: 'Enregistrer un document (multipart file)' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Req() req: any,
    @Body('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user.id;
    if (!type) throw new BadRequestException('Type de document requis');

    if (file?.buffer) {
      if (file.buffer.byteLength > 8 * 1024 * 1024) {
        throw new BadRequestException('Fichier trop volumineux (max 8MB)');
      }
      const result = await this.cloudinary.uploadImage(
        file.buffer,
        `koogwe/documents/${userId}/${type}`,
      );
      return this.driversService.uploadDocument(userId, type, result.url);
    }

    const fileUrl = (req.body as any)?.fileUrl;
    if (!fileUrl) throw new BadRequestException('Aucun fichier fourni');
    return this.driversService.uploadDocument(userId, type, fileUrl);
  }

  @Get('admin/pending')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  getPendingDrivers() {
    return this.driversService.getPendingDrivers();
  }

  @Patch('admin/:id/approve')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  approveDriver(@Param('id') id: string) {
    return this.driversService.approveDriver(id);
  }

  @Patch('admin/:id/reject')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  rejectDriver(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.driversService.rejectDriver(id, reason);
  }
}