// src/auth/auth.service.ts
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SendOtpDto, VerifyOtpDto, VerifyOtpAndPasswordDto, AdminLoginDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto'; // ✅ FIX #9 : crypto.randomInt (sécurisé)

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  // ─── Génération OTP 6 chiffres ────────────────────────────────────────────
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString(); // ✅ FIX #9 : crypto.randomInt
  }

  // ─── Envoi de l'OTP ───────────────────────────────────────────────────────
  async sendOtp(dto: SendOtpDto): Promise<{ message: string; expiresIn: number }> {
    const { email, language = 'fr' } = dto;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { otpAttempts: true, otpExpiresAt: true, otpCode: true },
    });

    if (existing?.otpAttempts >= 5 && existing?.otpExpiresAt && existing.otpExpiresAt > new Date()) {
      throw new HttpException(
        'Trop de tentatives. Veuillez réessayer dans 10 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otpCode = this.generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.user.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        otpCode,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        language,
      },
      update: {
        otpCode,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        language,
      },
    });

    await this.mail.sendOtp(normalizedEmail, otpCode, language);
    this.logger.log(`OTP envoyé à ${normalizedEmail}`);

    return { message: 'Code OTP envoyé par email', expiresIn: 600 };
  }

  // ─── Vérification OTP ─────────────────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto) {
    const { userBefore, updatedUser, isNewUser } = await this.consumeOtp(dto.email, dto.code);
    return this.buildAuthResponse(updatedUser, userBefore, isNewUser);
  }

  // ─── Vérification OTP + définition du mot de passe (inscription apps) ─────
  async verifyOtpAndSetPassword(dto: VerifyOtpAndPasswordDto) {
    const { userBefore, updatedUser, isNewUser } = await this.consumeOtp(dto.email, dto.code);
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const userWithPassword = await this.prisma.user.update({
      where: { id: updatedUser.id },
      data: { hashedPassword },
    });

    return this.buildAuthResponse(userWithPassword, userBefore, isNewUser);
  }

  private async consumeOtp(email: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const userBefore = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { driverProfile: true },
    });

    if (!userBefore) {
      throw new BadRequestException('Aucun compte trouvé pour cet email');
    }

    if (!userBefore.otpExpiresAt || userBefore.otpExpiresAt < new Date()) {
      throw new BadRequestException('Le code OTP a expiré. Veuillez en demander un nouveau.');
    }

    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS', 5));
    if (userBefore.otpAttempts >= maxAttempts) {
      throw new HttpException(
        'Trop de tentatives incorrectes. Demandez un nouveau code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (userBefore.otpCode !== code) {
      await this.prisma.user.update({
        where: { email: normalizedEmail },
        data: { otpAttempts: { increment: 1 } },
      });
      const remaining = maxAttempts - userBefore.otpAttempts - 1;
      throw new BadRequestException(`Code incorrect. ${remaining} tentative(s) restante(s).`);
    }

    const isNewUser = !userBefore.isVerified;

    const updatedUser = await this.prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    if (isNewUser) {
      await this.mail.sendWelcome(normalizedEmail, userBefore.firstName ?? 'là', userBefore.language);
      try {
        await this.prisma.wallet.upsert({
          where: { userId: updatedUser.id },
          create: { userId: updatedUser.id, balance: 0 },
          update: {},
        });
      } catch (e: any) {
        this.logger.warn(`Wallet création échouée ${updatedUser.id}: ${e?.message || e}`);
      }
    }

    return { userBefore, updatedUser, isNewUser };
  }

  private async buildAuthResponse(
    updatedUser: { id: string; email: string; firstName: string | null; lastName: string | null; avatarUrl: string | null; role: string; isVerified: boolean; language: string },
    userBefore: { driverProfile: { adminApproved: boolean } | null },
    isNewUser: boolean,
  ) {
    const tokens = await this.generateTokens(updatedUser.id, updatedUser.email, updatedUser.role);

    await this.prisma.user.update({
      where: { id: updatedUser.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return {
      ...tokens,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        avatarUrl: updatedUser.avatarUrl,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        language: updatedUser.language,
        hasDriver: !!userBefore.driverProfile,
        driverStatus: userBefore.driverProfile?.adminApproved
          ? 'APPROVED'
          : userBefore.driverProfile
            ? 'PENDING'
            : null,
      },
      isNewUser,
    };
  }

  // ─── CONNEXION PASSAGER / CHAUFFEUR (email + mot de passe) ──────────────────
  async loginWithPassword(email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { driverProfile: true },
    });

    if (!user) throw new UnauthorizedException('Email ou mot de passe incorrect');
    if (!user.isActive) throw new UnauthorizedException('Ce compte est desactive');
    if (!user.hashedPassword) throw new UnauthorizedException('Aucun mot de passe configure. Utilisez la connexion OTP.');

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) throw new UnauthorizedException('Email ou mot de passe incorrect');

    // 🔧 FIX : s'assurer que le wallet existe (rétrocompatibilité)
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balance: 0 },
      update: {},
    }).catch(() => undefined);

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        language: user.language,
        hasDriver: !!user.driverProfile,
        driverStatus: user.driverProfile?.adminApproved ? 'APPROVED' : (user.driverProfile ? 'PENDING' : null),
      },
      isNewUser: false,
    };
  }

  // ─── CONNEXION ADMIN (email + mot de passe) ───────────────────────────────
  async adminLogin(dto: AdminLoginDto) {
    const { email, password } = dto;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        avatarUrl: true,
        hashedPassword: true,
      },
    });

    if (!user) {
      this.logger.warn(`Tentative de connexion admin échouée : utilisateur ${normalizedEmail} non trouvé`);
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.role !== 'ADMIN') {
      this.logger.warn(`Tentative de connexion admin rejetée : ${normalizedEmail} n'est pas ADMIN (rôle: ${user.role})`);
      throw new UnauthorizedException('Accès réservé aux administrateurs');
    }

    if (!user.isActive) {
      this.logger.warn(`Tentative de connexion admin rejetée : ${normalizedEmail} est désactivé`);
      throw new UnauthorizedException('Ce compte est désactivé');
    }

    if (!user.hashedPassword) {
      this.logger.error(`Admin ${normalizedEmail} n'a pas de mot de passe configuré`);
      throw new UnauthorizedException('Compte admin non configuré correctement');
    }

    const passwordValid = await bcrypt.compare(password, user.hashedPassword);

    if (!passwordValid) {
      this.logger.warn(`Tentative de connexion admin échouée : mot de passe incorrect pour ${normalizedEmail}`);
      throw new UnauthorizedException('Identifiants invalides');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    this.logger.log(`✅ Connexion admin réussie : ${normalizedEmail}`);

    return {
      token: tokens.accessToken,           // ← Clé principale attendue par le frontend
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Administrateur',
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  // ─── Refresh token ────────────────────────────────────────────────────────
  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, refreshToken: true, isActive: true },
    });

    if (!user || !user.isActive || user.refreshToken !== refreshToken) {
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return tokens;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, fcmToken: null },
    });
  }

  // ─── Mise à jour FCM token ────────────────────────────────────────────────
  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });
  }

  // ─── Génération des tokens JWT ────────────────────────────────────────────
  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}