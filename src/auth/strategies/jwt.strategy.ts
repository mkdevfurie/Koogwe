// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, isVerified: true, language: true,
        accountStatus: true, adminRole: true,
        driverProfile: {
          select: {
            id: true, isOnline: true, adminApproved: true,
            faceVerified: true, documentsUploaded: true,
            vehicleType: true, vehicleMake: true, vehicleModel: true,
            licensePlate: true, rating: true,
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Compte introuvable');
    }

    const accountOk =
      user.isActive ||
      user.accountStatus === 'ACTIVE' ||
      (user.driverProfile != null && user.driverProfile.adminApproved);

    if (!accountOk) {
      throw new UnauthorizedException(
        'Compte inactif. Utilisez la connexion OTP ou contactez le support.',
      );
    }

    return user;
  }
}
