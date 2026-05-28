import { Controller, Post, Req, Headers, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@ApiTags('Webhooks')
@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private walletService: WalletService) {}

  @Public()
  @Post()
  async handleStripe(
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new BadRequestException('Corps de requête manquant');
    }

    try {
      await this.walletService.handleStripeWebhook(rawBody, signature);
      return { received: true };
    } catch (e) {
      this.logger.error(`Webhook Stripe rejeté: ${(e as Error).message}`);
      throw new BadRequestException((e as Error).message);
    }
  }
}
