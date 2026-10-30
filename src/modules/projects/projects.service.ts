import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AuditAction,
  OrganizationRole,
  Prisma,
  ProjectRole,
  ProjectStatus,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CacheInvalidationService } from '../../common/redis/cache-invalidation.service';
import { validateDateRange } from '../../utils';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly cacheInvalidationService?: CacheInvalidationService,
    @Optional()
    private readonly auditLogsService?: AuditLogsService,
  ) {}

  private validateDates(
    startDate?: string | Date | null,
    endDate?: string | Date | null,
  ): void {
    validateDateRange(
      startDate,
      endDate,
      'Start date cannot be after end date',
    );
  }

  async create(userId: string, dto: CreateProjectDto) {
    this.validateDates(dto.startDate, dto.endDate);

    const orgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: dto.organizationId,
          userId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenException(
        'You must be a member of the organization to create a project',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          description: dto.description,
          organizationId: dto.organizationId,
          createdById: userId,
          status: dto.status ?? ProjectStatus.PLANNED,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          projectRole: ProjectRole.PROJECT_MANAGER,
        },
      });

      await this.auditLogsService?.record(
        {
          userId,
          action: AuditAction.CREATE,
          entityType: 'PROJECT',
          entityId: project.id,
          organizationId: dto.organizationId,
          projectId: project.id,
          metadata: {
            name: project.name,
            status: project.status,
          },
        },
        tx,
      );

      return this.getProjectById(project.id, userId, tx);
    });
  }

  async findAllForUser(userId: string, query?: QueryProjectDto) {
    const whereClause: Prisma.ProjectWhereInput = {
      OR: [
        {
          members: {
            some: {
              userId,
            },
          },
        },
        {
          organization: {
            members: {
              some: {
                userId,
                role: OrganizationRole.ADMIN,
              },
            },
          },
        },
      ],
    };

    if (query?.organizationId) {
      whereClause.organizationId = query.organizationId;
    }

    if (query?.status) {
      whereClause.status = query.status;
    } else if (query?.includeArchived === false) {
      whereClause.status = {
        not: ProjectStatus.ARCHIVED,
      };
    }

    if (query?.search) {
      whereClause.AND = [
        {
          OR: [
            {
              name: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ],
        },
      ];
    }

    return this.prisma.project.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        members: {
          where: {
            userId,
          },
          select: {
            projectRole: true,
            joinedAt: true,
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
            issues: true,
            milestones: true,
          },
        },
      },
    });
  }

  async getProjectById(
    projectId: string,
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await this.assertProjectMember(projectId, userId, client);

    const project = await client.project.findUnique({
      where: {
        id: projectId,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        members: {
          orderBy: {
            joinedAt: 'asc',
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
            issues: true,
            milestones: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    await this.assertProjectRole(projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing) {
      throw new NotFoundException('Project not found');
    }

    const effectiveStartDate =
      dto.startDate !== undefined ? dto.startDate : existing.startDate;
    const effectiveEndDate =
      dto.endDate !== undefined ? dto.endDate : existing.endDate;

    this.validateDates(effectiveStartDate, effectiveEndDate);

    const updateData: Prisma.ProjectUpdateInput = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    if (dto.startDate !== undefined) {
      updateData.startDate = dto.startDate ? new Date(dto.startDate) : null;
    }

    if (dto.endDate !== undefined) {
      updateData.endDate = dto.endDate ? new Date(dto.endDate) : null;
    }

    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (
        dto.status === ProjectStatus.ARCHIVED &&
        existing.status !== ProjectStatus.ARCHIVED
      ) {
        updateData.archivedAt = new Date();
      } else if (
        dto.status !== ProjectStatus.ARCHIVED &&
        existing.status === ProjectStatus.ARCHIVED
      ) {
        updateData.archivedAt = null;
      }
    }

    const updated = await this.prisma.project.update({
      where: {
        id: projectId,
      },
      data: updateData,
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
            issues: true,
            milestones: true,
          },
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    void this.auditLogsService?.record({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'PROJECT',
      entityId: projectId,
      organizationId: existing.organizationId,
      projectId,
      metadata: {
        changes: updateData,
      },
    });

    return updated;
  }

  async archive(projectId: string, userId: string) {
    await this.assertProjectRole(projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const updatedArchive = await this.prisma.project.update({
      where: {
        id: projectId,
      },
      data: {
        status: ProjectStatus.ARCHIVED,
        archivedAt: new Date(),
      },
      include: {
        _count: {
          select: {
            members: true,
            tasks: true,
            issues: true,
            milestones: true,
          },
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    return updatedArchive;
  }

  async unarchive(projectId: string, userId: string) {
    await this.assertProjectRole(projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const updatedUnarchive = await this.prisma.project.update({
      where: {
        id: projectId,
      },
      data: {
        status: ProjectStatus.ACTIVE,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            members: true,
            tasks: true,
            issues: true,
            milestones: true,
          },
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    return updatedUnarchive;
  }

  async delete(projectId: string, userId: string) {
    await this.assertProjectRole(projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const deleted = await this.prisma.project.delete({
      where: {
        id: projectId,
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    void this.auditLogsService?.record({
      userId,
      action: AuditAction.DELETE,
      entityType: 'PROJECT',
      entityId: projectId,
      organizationId: deleted.organizationId,
      projectId,
      metadata: {
        name: deleted.name,
      },
    });

    return {
      message: 'Project deleted successfully',
    };
  }

  async listMembers(projectId: string, userId: string) {
    await this.assertProjectMember(projectId, userId);

    return this.prisma.projectMember.findMany({
      where: {
        projectId,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }

  async addMember(
    projectId: string,
    actorUserId: string,
    targetUserId: string,
    role: ProjectRole,
  ) {
    await this.assertProjectRole(projectId, actorUserId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: {
        id: targetUserId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (targetUser.status !== 'ACTIVE') {
      throw new ConflictException('Cannot add an inactive user');
    }

    const orgMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!orgMembership) {
      throw new BadRequestException(
        'User must be a member of the organization before joining this project',
      );
    }

    const existingProjectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    if (existingProjectMember) {
      throw new ConflictException('User is already a member of this project');
    }

    const newMember = await this.prisma.projectMember.create({
      data: {
        projectId,
        userId: targetUserId,
        projectRole: role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    return newMember;
  }

  async updateMemberRole(
    projectId: string,
    actorUserId: string,
    targetUserId: string,
    role: ProjectRole,
  ) {
    await this.assertProjectRole(projectId, actorUserId, [
      ProjectRole.PROJECT_MANAGER,
    ]);

    const targetMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException('Project member not found');
    }

    if (
      targetMember.projectRole === ProjectRole.PROJECT_MANAGER &&
      role !== ProjectRole.PROJECT_MANAGER
    ) {
      const managerCount = await this.prisma.projectMember.count({
        where: {
          projectId,
          projectRole: ProjectRole.PROJECT_MANAGER,
        },
      });

      if (managerCount <= 1) {
        throw new ForbiddenException(
          'A project must have at least one project manager',
        );
      }
    }

    const updatedRole = await this.prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
      data: {
        projectRole: role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    return updatedRole;
  }

  async removeMember(
    projectId: string,
    actorUserId: string,
    targetUserId: string,
  ) {
    if (actorUserId !== targetUserId) {
      await this.assertProjectRole(projectId, actorUserId, [
        ProjectRole.PROJECT_MANAGER,
      ]);
    } else {
      await this.assertProjectMember(projectId, actorUserId);
    }

    const targetMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException('Project member not found');
    }

    if (targetMember.projectRole === ProjectRole.PROJECT_MANAGER) {
      const managerCount = await this.prisma.projectMember.count({
        where: {
          projectId,
          projectRole: ProjectRole.PROJECT_MANAGER,
        },
      });

      if (managerCount <= 1) {
        throw new ForbiddenException(
          'The final project manager cannot be removed from the project',
        );
      }
    }

    await this.prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    void this.cacheInvalidationService?.invalidateProject(projectId);

    return {
      message: 'Member removed successfully from project',
    };
  }

  async getMember(projectId: string, userId: string) {
    return this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }

  async assertProjectMember(
    projectId: string,
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const member = await client.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (member) {
      return member;
    }

    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const orgMember = await client.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
    });

    if (orgMember && orgMember.role === OrganizationRole.ADMIN) {
      return {
        projectId,
        userId,
        projectRole: ProjectRole.PROJECT_MANAGER,
        joinedAt: orgMember.joinedAt,
        isOrgAdmin: true,
      };
    }

    throw new ForbiddenException('You are not a member of this project');
  }

  async assertProjectRole(
    projectId: string,
    userId: string,
    allowedRoles: ProjectRole[],
  ) {
    const member = await this.assertProjectMember(projectId, userId);

    if (
      (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
      allowedRoles.includes(member.projectRole)
    ) {
      return member;
    }

    throw new ForbiddenException(
      'You do not have permission to perform this action in this project',
    );
  }
}
