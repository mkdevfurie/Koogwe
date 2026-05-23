import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/guards/jwt-auth.guard';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'koogwe-api',
      timestamp: new Date().toISOString(),
      gitCommit:
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.RAILWAY_GIT_COMMIT ??
        process.env.GIT_COMMIT ??
        null,
    };
  }
}
