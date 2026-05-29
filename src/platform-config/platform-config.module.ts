import { Global, Module } from '@nestjs/common';
import { PlatformConfigService } from './platform-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformConfigController } from './platform-config.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PlatformConfigController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
