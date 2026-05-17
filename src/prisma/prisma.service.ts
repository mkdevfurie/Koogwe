// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('📡 Connecté à la base de données');

      const adminEmail = process.env.ADMIN_EMAIL || 'admin@koogwe.com';
      const adminCount = await this.user.count({ where: { role: 'ADMIN' } });

      if (adminCount === 0) {
        const plainPassword = process.env.ADMIN_PASSWORD || 'AdminKoogwe2026!';
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const admin = await this.user.create({
          data: {
            email: adminEmail,
            hashedPassword,
            firstName: 'Super',
            lastName: 'Admin',
            role: 'ADMIN',
            isActive: true,
            isVerified: true,
            accountStatus: 'ACTIVE',
          },
        });

        await this.wallet.create({ data: { userId: admin.id, balance: 0 } });

        this.logger.log(`✅ Premier administrateur créé : ${adminEmail}`);
        this.logger.log(`🔑 Mot de passe : ${plainPassword}`);
      } else {
        this.logger.log('👤 Un administrateur existe déjà.');
      }

      // 🔧 Crée un wallet pour tous les utilisateurs qui n'en ont pas
      const usersWithoutWallet = await this.user.findMany({
        where: { wallet: null },
        select: { id: true },
      });
      if (usersWithoutWallet.length > 0) {
        this.logger.log(`🔧 Création de ${usersWithoutWallet.length} wallets manquants…`);
        await this.wallet.createMany({
          data: usersWithoutWallet.map((u) => ({ userId: u.id, balance: 0 })),
          skipDuplicates: true,
        });
        this.logger.log('✅ Wallets manquants créés.');
      }
    } catch (error) {
      this.logger.error('❌ Erreur init Prisma:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}