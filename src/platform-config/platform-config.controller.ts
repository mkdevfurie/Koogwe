import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { PlatformConfigService } from './platform-config.service';

@ApiTags('Config')
@Controller('config')
export class PlatformConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Configuration publique (apps mobile)' })
  getPublic() {
    return this.config.getPublicAppConfig();
  }
}
