import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/guards/jwt-auth.guard';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'koogwe-api', timestamp: new Date().toISOString() };
  }
}
