// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { AdminFeaturesService } from './admin-features.service';
import { AdminRoleGuard } from './admin-role.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommonModule } from '../common/common.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Module({
  imports: [PrismaModule, MailModule, WalletModule, CommonModule, PlatformConfigModule],
  controllers: [AdminController],
  providers: [AdminService, AuditService, AdminFeaturesService, AdminRoleGuard],
  exports: [AdminService, AuditService, AdminFeaturesService],
})
export class AdminModule {}