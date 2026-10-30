import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AuditAction,
  IssuePriority,
  IssueStatus,
  OrganizationRole,
  Prisma,
  ProjectRole,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CacheInvalidationService } from '../../common/redis/cache-invalidation.service';
import { assertProjectAssignee, buildPaginatedResponse } from '../../helpers';
import { SocketGateway } from '../websockets';
import { getPaginationOffset } from '../../utils';
import { ProjectsService } from '../projects/projects.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { IssueQueryDto } from './dto/issue-query.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Inject(forwardRef(() => SocketGateway))
    private readonly eventsGateway?: SocketGateway,
    @Optional()
    private readonly cacheInvalidationService?: CacheInvalidationService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService?: NotificationsService,
  ) {}

  private readonly userSelect = {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  };

  private readonly issueInclude = {
    reporter: this.userSelect,
    assignee: this.userSelect,
    project: {
      select: {
        id: true,
        name: true,
        organizationId: true,
      },
    },
    _count: {
      select: {
        comments: true,
        histories: true,
      },
    },
  };

  async create(userId: string, dto: CreateIssueDto, clientMutationId?: string) {
    const member = await this.projectsService.assertProjectMember(
      dto.projectId,
      userId,
    );

    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException(
        'Viewers do not have permission to report issues',
      );
    }

    if (dto.assigneeId) {
      await assertProjectAssignee(this.prisma, dto.projectId, dto.assigneeId);
    }

    const issue = await this.prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: {
          projectId: dto.projectId,
          reporterId: userId,
          title: dto.title.trim(),
          description: dto.description?.trim(),
          severity: dto.severity,
          priority: dto.priority ?? IssuePriority.MEDIUM,
          status: dto.status ?? IssueStatus.OPEN,
          assigneeId: dto.assigneeId ?? null,
        },
        include: this.issueInclude,
      });

      await tx.issueHistory.create({
        data: {
          issueId: created.id,
          userId,
          action: AuditAction.CREATE,
          newValue: {
            title: created.title,
            description: created.description,
            severity: created.severity,
            priority: created.priority,
            status: created.status,
            reporterId: created.reporterId,
            assigneeId: created.assigneeId,
          } as Prisma.InputJsonObject,
        },
      });

      if (created.assigneeId) {
        await tx.issueHistory.create({
          data: {
            issueId: created.id,
            userId,
            action: AuditAction.ASSIGN,
            newValue: {
              assigneeId: created.assigneeId,
            } as Prisma.InputJsonObject,
          },
        });
      }

      return created;
    });

    this.eventsGateway?.emitIssueCreated(
      dto.projectId,
      issue,
      clientMutationId,
    );

    if (issue.assigneeId) {
      this.eventsGateway?.emitIssueAssigned(dto.projectId, {
        issueId: issue.id,
        oldAssigneeId: null,
        newAssigneeId: issue.assigneeId,
        issue,
        clientMutationId,
      });
    }

    void this.cacheInvalidationService?.invalidateIssue(dto.projectId);

    if (issue.assigneeId) {
      void this.prisma.user
        .findUnique({
          where: { id: userId },
          select: { name: true },
        })
        .then((actor) => {
          void this.notificationsService?.notifyIssueAssigned(
            {
              id: issue.id,
              title: issue.title,
              projectId: issue.projectId,
              assigneeId: issue.assigneeId!,
            },
            { id: userId, name: actor?.name || 'A team member' },
          );
        });
    }

    return issue;
  }

  async findAll(userId: string, query: IssueQueryDto) {
    if (query.projectId) {
      await this.projectsService.assertProjectMember(query.projectId, userId);
    }

    const whereClause: Prisma.IssueWhereInput = {};

    if (query.projectId) {
      whereClause.projectId = query.projectId;
    } else {
      whereClause.project = {
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
    }

    if (!query.includeDeleted) {
      whereClause.deletedAt = null;
    }

    if (query.reporterId) {
      whereClause.reporterId = query.reporterId;
    }

    if (query.assigneeId) {
      if (query.assigneeId === 'unassigned') {
        whereClause.assigneeId = null;
      } else {
        whereClause.assigneeId = query.assigneeId;
      }
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.severity) {
      whereClause.severity = query.severity;
    }

    if (query.priority) {
      whereClause.priority = query.priority;
    }

    if (query.search) {
      whereClause.AND = [
        {
          OR: [
            {
              title: {
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

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const [total, issues] = await this.prisma.$transaction([
      this.prisma.issue.count({ where: whereClause }),
      this.prisma.issue.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: this.issueInclude,
      }),
    ]);

    return buildPaginatedResponse(issues, total, page, limit);
  }

  async findById(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: this.issueInclude,
    });

    if (!issue || issue.deletedAt !== null) {
      throw new NotFoundException('Issue not found');
    }

    await this.projectsService.assertProjectMember(issue.projectId, userId);

    return issue;
  }

  async update(
    issueId: string,
    userId: string,
    dto: UpdateIssueDto,
    clientMutationId?: string,
  ) {
    const existing = await this.prisma.issue.findUnique({
      where: { id: issueId },
    });

    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException('Issue not found');
    }

    const member = await this.projectsService.assertProjectMember(
      existing.projectId,
      userId,
    );

    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot modify issues');
    }

    const isManagerOrLead =
      (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
      member.projectRole === ProjectRole.PROJECT_MANAGER ||
      member.projectRole === ProjectRole.TEAM_LEAD;

    if (!isManagerOrLead) {
      const isReporter = existing.reporterId === userId;
      const isAssignee = existing.assigneeId === userId;

      if (!isReporter && !isAssignee) {
        throw new ForbiddenException(
          'You do not have permission to modify this issue',
        );
      }

      const isAttemptingRestrictedFields =
        dto.title !== undefined ||
        dto.description !== undefined ||
        dto.severity !== undefined ||
        dto.priority !== undefined ||
        dto.assigneeId !== undefined;

      if (isAttemptingRestrictedFields) {
        throw new ForbiddenException(
          'Developers can only update the workflow status of their reported or assigned issues',
        );
      }
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      await assertProjectAssignee(
        this.prisma,
        existing.projectId,
        dto.assigneeId,
      );
    }

    const changedFields: Record<string, Prisma.InputJsonValue | null> = {};
    const updated = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.IssueUpdateInput = {};
      const historyCreations: Promise<unknown>[] = [];

      if (dto.status !== undefined && dto.status !== existing.status) {
        updateData.status = dto.status;
        const isResolving =
          dto.status === IssueStatus.RESOLVED ||
          dto.status === IssueStatus.CLOSED;
        const wasResolved =
          existing.status === IssueStatus.RESOLVED ||
          existing.status === IssueStatus.CLOSED;

        if (isResolving && !wasResolved) {
          updateData.resolvedAt = new Date();
        } else if (!isResolving && wasResolved) {
          updateData.resolvedAt = null;
        }

        historyCreations.push(
          tx.issueHistory.create({
            data: {
              issueId,
              userId,
              action: AuditAction.STATUS_CHANGE,
              oldValue: {
                status: existing.status,
              } as Prisma.InputJsonObject,
              newValue: {
                status: dto.status,
              } as Prisma.InputJsonObject,
            },
          }),
        );
      }

      if (
        dto.assigneeId !== undefined &&
        dto.assigneeId !== existing.assigneeId
      ) {
        if (dto.assigneeId === null) {
          updateData.assignee = { disconnect: true };
          historyCreations.push(
            tx.issueHistory.create({
              data: {
                issueId,
                userId,
                action: AuditAction.UNASSIGN,
                oldValue: {
                  assigneeId: existing.assigneeId,
                } as Prisma.InputJsonObject,
              },
            }),
          );
        } else {
          updateData.assignee = {
            connect: { id: dto.assigneeId },
          };
          historyCreations.push(
            tx.issueHistory.create({
              data: {
                issueId,
                userId,
                action: AuditAction.ASSIGN,
                oldValue: {
                  assigneeId: existing.assigneeId,
                } as Prisma.InputJsonObject,
                newValue: {
                  assigneeId: dto.assigneeId,
                } as Prisma.InputJsonObject,
              },
            }),
          );
        }
      }

      const oldFields: Record<string, Prisma.InputJsonValue | null> = {};

      if (dto.title !== undefined && dto.title.trim() !== existing.title) {
        updateData.title = dto.title.trim();
        changedFields.title = dto.title.trim();
        oldFields.title = existing.title;
      }

      if (
        dto.description !== undefined &&
        dto.description !== existing.description
      ) {
        updateData.description = dto.description;
        changedFields.description = dto.description ?? null;
        oldFields.description = existing.description ?? null;
      }

      if (dto.severity !== undefined && dto.severity !== existing.severity) {
        updateData.severity = dto.severity;
        changedFields.severity = dto.severity;
        oldFields.severity = existing.severity;
      }

      if (dto.priority !== undefined && dto.priority !== existing.priority) {
        updateData.priority = dto.priority;
        changedFields.priority = dto.priority;
        oldFields.priority = existing.priority;
      }

      if (Object.keys(changedFields).length > 0) {
        historyCreations.push(
          tx.issueHistory.create({
            data: {
              issueId,
              userId,
              action: AuditAction.UPDATE,
              oldValue: oldFields as Prisma.InputJsonObject,
              newValue: changedFields as Prisma.InputJsonObject,
            },
          }),
        );
      }

      const updated = await tx.issue.update({
        where: { id: issueId },
        data: updateData,
        include: this.issueInclude,
      });

      await Promise.all(historyCreations);

      return updated;
    });

    const projectId = existing.projectId;

    if (dto.status !== undefined && dto.status !== existing.status) {
      this.eventsGateway?.emitIssueStatusChanged(projectId, {
        issueId,
        oldStatus: existing.status,
        newStatus: dto.status,
        issue: updated,
        clientMutationId,
      });
    }

    if (
      dto.assigneeId !== undefined &&
      dto.assigneeId !== existing.assigneeId
    ) {
      this.eventsGateway?.emitIssueAssigned(projectId, {
        issueId,
        oldAssigneeId: existing.assigneeId,
        newAssigneeId: dto.assigneeId,
        issue: updated,
        clientMutationId,
      });
    }

    if (Object.keys(changedFields).length > 0) {
      this.eventsGateway?.emitIssueUpdated(projectId, {
        issue: updated,
        changedFields,
        clientMutationId,
      });
    }

    void this.cacheInvalidationService?.invalidateIssue(projectId);

    void this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { name: true },
      })
      .then((actor) => {
        const actorObj = { id: userId, name: actor?.name || 'A team member' };

        if (dto.assigneeId && dto.assigneeId !== existing.assigneeId) {
          void this.notificationsService?.notifyIssueAssigned(
            {
              id: updated.id,
              title: updated.title,
              projectId: updated.projectId,
              assigneeId: dto.assigneeId,
            },
            actorObj,
          );
        }

        const notifyChanges = { ...changedFields };
        if (dto.status !== undefined && dto.status !== existing.status) {
          notifyChanges.status = dto.status;
        }

        if (Object.keys(notifyChanges).length > 0) {
          void this.notificationsService?.notifyIssueUpdated(
            {
              id: updated.id,
              title: updated.title,
              projectId: updated.projectId,
              assigneeId: updated.assigneeId,
              reporterId: updated.reporterId,
            },
            actorObj,
            notifyChanges,
          );
        }
      });

    return updated;
  }

  async updateStatus(
    issueId: string,
    userId: string,
    status: IssueStatus,
    clientMutationId?: string,
  ) {
    return this.update(issueId, userId, { status }, clientMutationId);
  }

  async assign(
    issueId: string,
    userId: string,
    assigneeId: string | null,
    clientMutationId?: string,
  ) {
    return this.update(issueId, userId, { assigneeId }, clientMutationId);
  }

  async delete(issueId: string, userId: string, clientMutationId?: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
    });

    if (!issue || issue.deletedAt !== null) {
      throw new NotFoundException('Issue not found');
    }

    await this.projectsService.assertProjectRole(issue.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.issue.update({
        where: { id: issueId },
        data: {
          deletedAt: new Date(),
        },
      });

      await tx.issueHistory.create({
        data: {
          issueId,
          userId,
          action: AuditAction.DELETE,
          oldValue: {
            id: issue.id,
            title: issue.title,
          } as Prisma.InputJsonObject,
        },
      });

      return {
        message: 'Issue deleted successfully',
        issueId: deleted.id,
      };
    });

    this.eventsGateway?.emitIssueDeleted(issue.projectId, {
      issueId,
      deletedBy: userId,
      clientMutationId,
    });

    void this.cacheInvalidationService?.invalidateIssue(issue.projectId);

    return result;
  }

  async getHistory(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    await this.projectsService.assertProjectMember(issue.projectId, userId);

    return this.prisma.issueHistory.findMany({
      where: { issueId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: this.userSelect,
      },
    });
  }
}
