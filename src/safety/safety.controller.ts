import { Body, Controller, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SafetyService } from './safety.service';

@ApiTags('Safety')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('panic')
  @HttpCode(HttpStatus.CREATED)
  triggerPanic(
    @Request() req: { user: { id: string } },
    @Body() body: { lat?: number; lng?: number; rideId?: string; note?: string },
  ) {
    return this.safety.triggerPanic(req.user.id, body);
  }
}
