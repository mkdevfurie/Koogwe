// src/mail/mail.module.ts
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailTemplateService } from './mail-template.service';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Global()
@Module({
  imports: [PlatformConfigModule],
  providers: [MailService, MailTemplateService],
  exports: [MailService, MailTemplateService],
})
export class MailModule {}
