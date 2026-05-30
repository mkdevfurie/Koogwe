import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { ADMIN_ROLES_KEY, ADMIN_WRITE_KEY } from './admin-role.decorator';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }

    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminRole: AdminRole = user.adminRole ?? 'SUPER_ADMIN';

    if (requiredRoles?.length && !requiredRoles.includes(adminRole)) {
      throw new ForbiddenException('Permissions insuffisantes');
    }

    const writeRequired = this.reflector.getAllAndOverride<boolean>(ADMIN_WRITE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (writeRequired && adminRole === 'READONLY') {
      throw new ForbiddenException('Compte lecture seule — action non autorisée');
    }

    return true;
  }
}
