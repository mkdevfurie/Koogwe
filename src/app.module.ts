// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { AdminModule } from './admin/admin.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { WalletModule } from './wallet/wallet.module';
import { DocumentsModule } from './documents/documents.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    // 1. Configuration globale (doit être en premier)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Rate Limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,      // 1 minute
        limit: 100,     // Augmenté pour éviter les erreurs 429 en test
      },
      {
        name: 'medium',
        ttl: 600000,     // 10 minutes
        limit: 300,
      },
    ]),

    // 3. Core & Infrastructure
    PrismaModule,
    MailModule,
    CloudinaryModule,

    // 4. Feature Modules
    // ⚠️ AuthModule enregistre JwtModule avec JWT_ACCESS_SECRET via ConfigService
    // Ne pas ajouter un second JwtModule.register ici — cela crée un conflit
    AuthModule,
    UsersModule,
    DriversModule,
    RidesModule,
    AdminModule,
    WalletModule,
    DocumentsModule,
  ],
  providers: [
    // Global Guards
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,      // Protège toutes les routes par défaut
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,    // Protection anti-brute force
    },
    // ⚠️ AppGateway ne doit PAS être déclaré ici — il est fourni par CommonModule
    // importé dans RidesModule → évite les instances dupliquées
  ],
})
export class AppModule {}