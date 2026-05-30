// src/admin/admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { WalletService } from '../wallet/wallet.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { MailTemplateService } from '../mail/mail-template.service';
import { MailService } from '../mail/mail.service';
import { EmailTemplateKey } from '../mail/email-templates.defaults';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Guard qui vérifie que l'utilisateur est bien ADMIN
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
    return true;
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly walletService: WalletService,
    private readonly platformConfig: PlatformConfigService,
    private readonly mailTemplates: MailTemplateService,
    private readonly mail: MailService,
  ) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Statistiques globales du dashboard' })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('dashboard/rides/recent')
  @ApiOperation({ summary: 'Courses récentes' })
  getRecentRides() {
    return this.adminService.getRecentRides(10);
  }

  @Get('dashboard/documents/pending')
  @ApiOperation({ summary: 'Documents en attente de validation' })
  getPendingDocuments() {
    return this.adminService.getPendingDocuments();
  }

  // ─── Chauffeurs ────────────────────────────────────────────────────────────

  @Get('drivers')
  @ApiOperation({ summary: 'Liste de tous les chauffeurs' })
  getAllDrivers() {
    return this.adminService.getAllDrivers();
  }

  @Get('drivers/:id')
  @ApiOperation({ summary: 'Détail d\'un chauffeur' })
  getDriver(@Param('id') id: string) {
    return this.adminService.getDriver(id);
  }

  @Patch('drivers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspendre un chauffeur' })
  suspendDriver(@Param('id') id: string) {
    return this.adminService.suspendDriver(id);
  }

  @Patch('drivers/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activer/réactiver un chauffeur' })
  activateDriver(@Param('id') id: string) {
    return this.adminService.activateDriver(id);
  }

  @Patch('drivers/:id/approval')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuver ou rejeter un dossier chauffeur' })
  approveDriver(
    @Param('id') id: string,
    @Body() body: { approved: boolean; adminNotes?: string },
  ) {
    return this.adminService.approveOrRejectDriver(id, body.approved, body.adminNotes);
  }

  @Delete('drivers/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un chauffeur et son compte' })
  deleteDriver(@Param('id') id: string) {
    return this.adminService.deleteDriver(id);
  }

  // ─── Documents ─────────────────────────────────────────────────────────────

  @Get('documents')
  @ApiOperation({ summary: 'Liste des documents' })
  getAllDocuments(@Query('status') status?: string) {
    return this.adminService.getAllDocuments(status);
  }

  @Patch('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuver un document' })
  approveDocument(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.adminService.approveDocument(id, req.user.id);
  }

  @Patch('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejeter un document' })
  rejectDocument(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.rejectDocument(id, req.user.id, body.reason);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un document' })
  deleteDocument(@Param('id') id: string) {
    return this.adminService.deleteDocument(id);
  }

  // ─── Passagers ─────────────────────────────────────────────────────────────

  @Get('passengers')
  @ApiOperation({ summary: 'Liste de tous les passagers' })
  getAllPassengers() {
    return this.adminService.getAllPassengers();
  }

  @Patch('passengers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspendre un passager' })
  suspendPassenger(@Param('id') id: string) {
    return this.adminService.suspendPassenger(id);
  }

  @Patch('passengers/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activer un passager' })
  activatePassenger(@Param('id') id: string) {
    return this.adminService.activatePassenger(id);
  }

  @Delete('passengers/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un passager et son compte' })
  deletePassenger(@Param('id') id: string) {
    return this.adminService.deletePassenger(id);
  }

  // ─── Courses ───────────────────────────────────────────────────────────────

  @Get('rides')
  @ApiOperation({ summary: 'Liste de toutes les courses' })
  getAllRides(@Query('limit') limit?: number) {
    return this.adminService.getAllRides(limit ? Number(limit) : 50);
  }

  @Get('rides/active')
  @ApiOperation({ summary: 'Courses actives en ce moment' })
  getActiveRides() {
    return this.adminService.getActiveRides();
  }

  @Delete('rides/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer toutes les courses d\'un statut (REQUESTED, CANCELLED)' })
  deleteRidesBulk(@Query('status') status: string) {
    return this.adminService.deleteRidesByStatus(status || 'REQUESTED');
  }

  @Delete('rides/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer une course' })
  deleteRide(@Param('id') id: string) {
    return this.adminService.deleteRide(id);
  }

  // ─── Finances ──────────────────────────────────────────────────────────────

  @Get('finance/stats')
  @ApiOperation({ summary: 'Statistiques financières' })
  getFinanceStats() {
    return this.adminService.getFinanceStats();
  }

  @Get('finance/chart')
  @ApiOperation({ summary: 'Données graphique revenus' })
  getFinanceChart(@Query('period') period?: 'daily' | 'weekly' | 'monthly') {
    return this.adminService.getFinanceChart(period ?? 'weekly');
  }

  @Get('finance/transactions')
  @ApiOperation({ summary: 'Liste des transactions' })
  getFinanceTransactions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getFinanceTransactions(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  // ─── Wallet admin ─────────────────────────────────────────────────────────

  @Post('wallet/:userId/recharge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recharge manuelle du wallet d\'un utilisateur (admin)' })
  adminRechargeWallet(
    @Param('userId') userId: string,
    @Body() body: { amount: number },
  ) {
    if (!body?.amount || body.amount <= 0) {
      throw new BadRequestException('Montant invalide');
    }
    return this.walletService.rechargeManual(userId, body.amount);
  }

  // ─── Simulateur de prix ────────────────────────────────────────────────────

  @Post('estimate-price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimer le prix d\'une course (simulateur admin)' })
  estimatePrice(
    @Body() body: {
      distanceKm: number;
      durationMin: number;
      vehicleType: string;
      zone?: string;
      pickupLat?: number;
      pickupLng?: number;
      demandLevel?: string;
    },
  ) {
    return this.adminService.estimatePrice(body);
  }

  // ─── Configuration plateforme (persistée en base) ─────────────────────────

  @Get('config')
  async getConfig() {
    const [pricing, financials, payments, security, platform, emails] = await Promise.all([
      this.platformConfig.getPricing(),
      this.platformConfig.getFinancials(),
      this.platformConfig.getPayments(),
      this.platformConfig.getSecurity(),
      this.platformConfig.getPlatform(),
      this.platformConfig.getEmailTemplates(),
    ]);
    return { pricing, financials, payments, security, platform, emails };
  }

  @Get('config/pricing')
  getPricingConfig() {
    return this.platformConfig.getPricing();
  }

  @Patch('config/pricing')
  @HttpCode(HttpStatus.OK)
  updatePricingConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updatePricing(body as any);
  }

  @Get('config/financials')
  getFinancialsConfig() {
    return this.platformConfig.getFinancials();
  }

  @Patch('config/financials')
  @HttpCode(HttpStatus.OK)
  updateFinancialsConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updateFinancials(body);
  }

  @Get('config/security')
  getSecurityConfig() {
    return this.platformConfig.getSecurity();
  }

  @Patch('config/security')
  @HttpCode(HttpStatus.OK)
  updateSecurityConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updateSecurity(body);
  }

  @Get('config/payments')
  getPaymentsConfig() {
    return this.platformConfig.getPayments();
  }

  @Patch('config/payments')
  @HttpCode(HttpStatus.OK)
  updatePaymentsConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updatePayments(body as any);
  }

  @Get('config/platform')
  getPlatformConfig() {
    return this.platformConfig.getPlatform();
  }

  @Patch('config/platform')
  @HttpCode(HttpStatus.OK)
  updatePlatformConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updatePlatform(body as any);
  }

  @Get('config/emails')
  getEmailTemplatesConfig() {
    return this.platformConfig.getEmailTemplates();
  }

  @Patch('config/emails')
  @HttpCode(HttpStatus.OK)
  updateEmailTemplatesConfig(@Body() body: Record<string, unknown>) {
    return this.platformConfig.updateEmailTemplates(body as any);
  }

  @Post('config/emails/preview')
  @HttpCode(HttpStatus.OK)
  previewEmailTemplate(
    @Body() body: {
      key: EmailTemplateKey;
      language?: string;
      patch?: Record<string, unknown>;
    },
  ) {
    if (!body?.key) throw new BadRequestException('key requis');
    return this.mailTemplates.preview(body.key, body.language ?? 'fr', body.patch as any);
  }

  @Post('config/emails/test')
  @HttpCode(HttpStatus.OK)
  async testEmailTemplate(
    @Body() body: {
      key: EmailTemplateKey;
      to: string;
      language?: string;
    },
  ) {
    if (!body?.key || !body?.to) {
      throw new BadRequestException('key et to requis');
    }
    const rendered = await this.mailTemplates.preview(body.key, body.language ?? 'fr');
    await this.mail.sendTestEmail(body.to, rendered.subject, rendered.html);
    return { success: true, message: `Email test envoyé à ${body.to}` };
  }

  // ─── Zones chaudes ─────────────────────────────────────────────────────────

  @Get('hot-zones')
  listHotZones() {
    return this.platformConfig.listHotZones();
  }

  @Post('hot-zones')
  @HttpCode(HttpStatus.CREATED)
  createHotZone(
    @Body() body: {
      name: string;
      centerLat: number;
      centerLng: number;
      radiusKm?: number;
      surgeMultiplier?: number;
      isActive?: boolean;
    },
  ) {
    return this.platformConfig.createHotZone(body);
  }

  @Patch('hot-zones/:id')
  @HttpCode(HttpStatus.OK)
  updateHotZone(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.platformConfig.updateHotZone(id, body as any);
  }

  @Delete('hot-zones/:id')
  @HttpCode(HttpStatus.OK)
  deleteHotZone(@Param('id') id: string) {
    return this.platformConfig.deleteHotZone(id);
  }

  // ─── Panics (stub) ─────────────────────────────────────────────────────────

  @Get('panics')
  getPanics() {
    return [];
  }

  @Get('panics/active')
  getActivePanics() {
    return [];
  }
}
