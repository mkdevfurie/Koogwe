import { Module } from '@nestjs/common';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';
import { CommonModule } from '../common/common.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CommonModule, PlatformConfigModule, NotificationsModule],
  controllers: [SafetyController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
