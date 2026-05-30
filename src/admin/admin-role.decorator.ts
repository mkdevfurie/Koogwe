import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ADMIN_ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export const ADMIN_WRITE_KEY = 'adminWrite';
export const AdminWrite = () => SetMetadata(ADMIN_WRITE_KEY, true);
