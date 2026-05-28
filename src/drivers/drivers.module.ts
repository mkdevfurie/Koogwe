// src/drivers/drivers.module.ts
import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { FaceVerificationModule } from '../face-verification/face-verification.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    CloudinaryModule,
    PrismaModule,
    CommonModule,
    FaceVerificationModule,   // ✅ On importe le module pour avoir accès au service exporté
  ],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
