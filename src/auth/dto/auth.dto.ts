// src/auth/dto/auth.dto.ts
import { IsEmail, IsString, Length, IsOptional, IsIn, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiPropertyOptional({ example: 'fr', enum: ['fr', 'en', 'es', 'pt', 'ht'] })
  @IsOptional()
  @IsIn(['fr', 'en', 'es', 'pt', 'ht'])
  language?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiProperty({ example: '482910' })
  @IsString()
  @Length(6, 6, { message: 'Le code OTP doit contenir exactement 6 chiffres' })
  code: string;
}

export class VerifyOtpAndPasswordDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiProperty({ example: '482910' })
  @IsString()
  @Length(6, 6, { message: 'Le code OTP doit contenir exactement 6 chiffres' })
  code: string;

  @ApiProperty({ example: 'MonMotDePasse123!' })
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password: string;

  @ApiPropertyOptional({ enum: ['passenger', 'driver'], description: 'App d\'inscription' })
  @IsOptional()
  @IsIn(['passenger', 'driver'])
  registerAs?: 'passenger' | 'driver';
}

export class LoginPasswordDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

// ─── NOUVEAU : Connexion admin par email + mot de passe ───────────────────────
export class AdminLoginDto {
  @ApiProperty({ example: 'admin@koogwe.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiProperty({ example: 'MotDePasseAdmin123!' })
  @IsString()
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  password: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    role: string;
    isVerified: boolean;
    language: string;
  };

  @ApiProperty()
  isNewUser: boolean;
}
