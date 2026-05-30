import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private prisma: PrismaService,
    private platformConfig: PlatformConfigService,
  ) {}

  async log(params: {
    adminId?: string;
    adminEmail?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }) {
    try {
      const security = await this.platformConfig.getSecurity();
      if (security.auditLogs === false) return null;

      return await this.prisma.auditLog.create({
        data: {
          adminId: params.adminId,
          adminEmail: params.adminEmail,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          metadata: (params.metadata ?? undefined) as object | undefined,
          ip: params.ip,
        },
      });
    } catch (e) {
      this.logger.warn(`Audit log failed: ${e?.message}`);
      return null;
    }
  }

  list(limit = 100, offset = 0, resourceType?: string) {
    return this.prisma.auditLog.findMany({
      where: resourceType ? { resourceType } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      skip: offset,
      include: {
        admin: { select: { id: true, email: true, firstName: true, lastName: true, adminRole: true } },
      },
    });
  }
}
