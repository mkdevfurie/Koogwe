// src/admin/admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
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
      timeOfDay?: string;
      trafficLevel?: string;
      weatherCondition?: string;
      demandLevel?: string;
    },
  ) {
    return this.adminService.estimatePrice(body);
  }

  // ─── Config (retourne des valeurs vides pour compatibilité) ────────────────

  @Get('config')
  getConfig() {
    return { message: 'Config disponible' };
  }

  @Get('config/pricing')
  getPricingConfig() {
    return { basePrice: 2.5, pricePerKm: 1.2, pricePerMin: 0.3 };
  }

  @Get('config/financials')
  getFinancialsConfig() {
    return { commissionRate: 0.15 };
  }

  @Get('config/security')
  getSecurityConfig() {
    return { otpMaxAttempts: 5, otpExpiry: 600 };
  }

  @Get('config/payments')
  getPaymentsConfig() {
    return { methods: ['CASH', 'CARD', 'ORANGE_MONEY'] };
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
