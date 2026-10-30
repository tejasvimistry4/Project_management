import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, ProjectRole, UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResponse } from '../../helpers/pagination.helper';
import { getPaginationOffset } from '../../utils/pagination.util';
import { ProjectsService } from '../projects/projects.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { sanitizeAuditMetadata } from './utils/audit-sanitizer.util';

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService?: ProjectsService,
  ) {}

  private readonly actorSelect = {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  };

  async record(dto: CreateAuditLogDto, tx?: Prisma.TransactionClient) {
    try {
      const safeMetadata = sanitizeAuditMetadata(dto.metadata ?? {});

      const enrichedMetadata: Record<string, any> = {
        ...safeMetadata,
      };

      if (dto.organizationId) {
        enrichedMetadata.organizationId = dto.organizationId;
      }
      if (dto.projectId) {
        enrichedMetadata.projectId = dto.projectId;
      }

      const dbClient = tx ?? this.prisma;

      return await dbClient.auditLog.create({
        data: {
          userId: dto.userId ?? null,
          action: dto.action,
          entityType: dto.entityType,
          entityId: dto.entityId,
          metadata:
            Object.keys(enrichedMetadata).length > 0
              ? enrichedMetadata
              : Prisma.JsonNull,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to record audit log: ${err.message}`,
        err.stack,
      );
      if (tx) {
        throw err;
      }
      return null;
    }
  }

  async recordTransactional(
    tx: Prisma.TransactionClient,
    dto: CreateAuditLogDto,
  ) {
    return this.record(dto, tx);
  }

  async findAll(
    query: QueryAuditLogsDto,
    actorId: string,
    actorRole: UserRole,
  ) {
    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const where: Prisma.AuditLogWhereInput = {};

    if (actorRole !== UserRole.ADMIN) {
      if (query.projectId && this.projectsService) {
        const member = await this.projectsService.assertProjectMember(
          query.projectId,
          actorId,
        );
        if (
          member.projectRole === ProjectRole.VIEWER ||
          member.projectRole === ProjectRole.DEVELOPER
        ) {
          throw new ForbiddenException(
            'Developers and Viewers do not have permission to view project audit logs',
          );
        }
      } else if (!query.projectId && !query.organizationId) {
        where.userId = actorId;
      }
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = {
        equals: query.entityType.toUpperCase(),
        mode: 'insensitive',
      };
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    if (query.projectId) {
      where.metadata = {
        path: ['projectId'],
        equals: query.projectId,
      };
    }

    if (query.organizationId) {
      where.metadata = {
        path: ['organizationId'],
        equals: query.organizationId,
      };
    }

    if (query.search) {
      where.entityType = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: this.actorSelect,
        },
      }),
    ]);

    return buildPaginatedResponse(logs, total, page, limit);
  }

  async findByEntity(entityType: string, entityId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType: entityType.toUpperCase(),
        entityId,
      },
      include: {
        user: this.actorSelect,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      entityType: entityType.toUpperCase(),
      entityId,
      history: logs,
    };
  }

  async findByProject(
    projectId: string,
    actorId: string,
    actorRole: UserRole,
    query: { page?: number; limit?: number },
  ) {
    return this.findAll(
      {
        ...query,
        projectId,
      },
      actorId,
      actorRole,
    );
  }

  async findMyActivity(
    userId: string,
    query: { page?: number; limit?: number },
  ) {
    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const where: Prisma.AuditLogWhereInput = {
      userId,
    };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: this.actorSelect,
        },
      }),
    ]);

    return buildPaginatedResponse(logs, total, page, limit);
  }

  async findById(id: string, actorId: string, actorRole: UserRole) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: this.actorSelect,
      },
    });

    if (!log) {
      throw new NotFoundException('Audit log not found');
    }

    if (actorRole !== UserRole.ADMIN && log.userId !== actorId) {
      const meta = log.metadata as Record<string, any> | null;
      if (meta?.projectId && this.projectsService) {
        await this.projectsService.assertProjectMember(meta.projectId, actorId);
      } else {
        throw new ForbiddenException(
          'You do not have permission to view this audit log',
        );
      }
    }

    return log;
  }
}
