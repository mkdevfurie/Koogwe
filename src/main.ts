// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // ─── Filtre global d'exceptions ───────────────────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());

  // ─── Limite taille payload (fix erreur 413) ───────────────────────────────
  app.use(bodyParser.json({ limit: '20mb' }));
  app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));

  // ─── Sécurité ─────────────────────────────────────────────────────────────
  app.use(helmet());                    // ← Correction : plus de .default()

 // ─── CORS (Production Ready) ──────────────────────────────────────────────
app.enableCors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = [
      // ── Admin Panel ──────────────────────────────────────────────
      'https://admin-koogwe-rho.vercel.app',
      'https://admin-koogwe.vercel.app',
      // ── Origines dynamiques via variable d'env ────────────────────
      ...(process.env.FRONTEND_URLS
        ? process.env.FRONTEND_URLS.split(',').map((u: string) => u.trim())
        : []),
      // ── Dev local ────────────────────────────────────────────────
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://localhost:4173',
    ].filter(Boolean);

    // Accepte aussi tous les sous-domaines vercel.app du projet admin
    const isVercelPreview = origin && /^https:\/\/admin-koogwe[a-z0-9-]*\.vercel\.app$/.test(origin);

    if (!origin || allowedOrigins.includes(origin) || isVercelPreview) {
      callback(null, true);
    } else {
      logger.warn(`CORS bloqué pour l'origine: ${origin}`);
      callback(new Error(`CORS bloqué : ${origin}`), false);
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
});


  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ─── Préfixe global /api ──────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Koogwe Transport API')
      .setDescription('Backend API pour les applications passager et chauffeur Koogwe')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth', 'Authentification OTP par email')
      .addTag('Admin', 'Administration')
      .addTag('Users', 'Gestion des profils utilisateurs')
      .addTag('Rides', 'Cycle de vie des courses')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log('Swagger disponible sur /api/docs');
  }

  // ─── Démarrage ────────────────────────────────────────────────────────────
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  
  logger.log(`🚀 Koogwe API démarrée sur le port ${port}`);
  logger.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();