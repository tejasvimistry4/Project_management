import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CommentEntityType,
  OrganizationRole,
  Prisma,
  ProjectRole,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResponse } from '../../helpers';
import { SocketGateway } from '../websockets';
import { getPaginationOffset } from '../../utils';
import { ProjectsService } from '../projects/projects.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Inject(forwardRef(() => SocketGateway))
    private readonly eventsGateway?: SocketGateway,
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

  private readonly commentInclude = {
    user: this.userSelect,
    task: {
      select: {
        id: true,
        title: true,
        projectId: true,
      },
    },
    issue: {
      select: {
        id: true,
        title: true,
        projectId: true,
      },
    },
  };

  private async resolveEntityProjectId(
    entityType: CommentEntityType,
    taskId?: string,
    issueId?: string,
  ): Promise<string> {
    if (entityType === CommentEntityType.TASK) {
      if (!taskId) {
        throw new BadRequestException(
          'taskId is required when entityType is TASK',
        );
      }

      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true, deletedAt: true },
      });

      if (!task || task.deletedAt !== null) {
        throw new NotFoundException('Task not found');
      }

      return task.projectId;
    }

    if (entityType === CommentEntityType.ISSUE) {
      if (!issueId) {
        throw new BadRequestException(
          'issueId is required when entityType is ISSUE',
        );
      }

      const issue = await this.prisma.issue.findUnique({
        where: { id: issueId },
        select: { id: true, projectId: true },
      });

      if (!issue) {
        throw new NotFoundException('Issue not found');
      }

      return issue.projectId;
    }

    throw new BadRequestException('Invalid entity type');
  }

  async create(
    userId: string,
    dto: CreateCommentDto,
    clientMutationId?: string,
  ) {
    const projectId = await this.resolveEntityProjectId(
      dto.entityType,
      dto.taskId,
      dto.issueId,
    );

    const member = await this.projectsService.assertProjectMember(
      projectId,
      userId,
    );

    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException(
        'Viewers do not have permission to add comments',
      );
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          userId,
          entityType: dto.entityType,
          taskId: dto.entityType === CommentEntityType.TASK ? dto.taskId : null,
          issueId:
            dto.entityType === CommentEntityType.ISSUE ? dto.issueId : null,
          content: dto.content.trim(),
        },
        include: this.commentInclude,
      });

      if (dto.entityType === CommentEntityType.TASK && dto.taskId) {
        await tx.taskHistory.create({
          data: {
            taskId: dto.taskId,
            userId,
            action: AuditAction.CREATE,
            newValue: {
              commentId: created.id,
              content: created.content,
            } as Prisma.InputJsonObject,
          },
        });
      } else if (dto.entityType === CommentEntityType.ISSUE && dto.issueId) {
        await tx.issueHistory.create({
          data: {
            issueId: dto.issueId,
            userId,
            action: AuditAction.CREATE,
            newValue: {
              commentId: created.id,
              content: created.content,
            } as Prisma.InputJsonObject,
          },
        });
      }

      return created;
    });

    this.eventsGateway?.emitCommentCreated(
      projectId,
      comment,
      clientMutationId,
    );

    return comment;
  }

  async findAll(userId: string, query: CommentQueryDto) {
    let projectId: string | undefined;

    if (query.taskId) {
      projectId = await this.resolveEntityProjectId(
        CommentEntityType.TASK,
        query.taskId,
        undefined,
      );
    } else if (query.issueId) {
      projectId = await this.resolveEntityProjectId(
        CommentEntityType.ISSUE,
        undefined,
        query.issueId,
      );
    }

    if (projectId) {
      await this.projectsService.assertProjectMember(projectId, userId);
    }

    const whereClause: Prisma.CommentWhereInput = {};

    if (query.entityType) {
      whereClause.entityType = query.entityType;
    }

    if (query.taskId) {
      whereClause.taskId = query.taskId;
    }

    if (query.issueId) {
      whereClause.issueId = query.issueId;
    }

    if (!query.taskId && !query.issueId) {
      whereClause.OR = [
        {
          task: {
            project: {
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
            },
          },
        },
        {
          issue: {
            project: {
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
            },
          },
        },
      ];
    }

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);
    const sortOrder = query.sortOrder ?? 'asc';

    const [total, comments] = await this.prisma.$transaction([
      this.prisma.comment.count({ where: whereClause }),
      this.prisma.comment.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: sortOrder,
        },
        include: this.commentInclude,
      }),
    ]);

    return buildPaginatedResponse(comments, total, page, limit);
  }

  async findById(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: this.commentInclude,
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const projectId = comment.task?.projectId ?? comment.issue?.projectId;

    if (projectId) {
      await this.projectsService.assertProjectMember(projectId, userId);
    }

    return comment;
  }

  async update(
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
    clientMutationId?: string,
  ) {
    const existing = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: this.commentInclude,
    });

    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const projectId = existing.task?.projectId ?? existing.issue?.projectId;

    if (projectId) {
      await this.projectsService.assertProjectMember(projectId, userId);
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const newContent = dto.content.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.comment.update({
        where: { id: commentId },
        data: {
          content: newContent,
        },
        include: this.commentInclude,
      });

      if (existing.entityType === CommentEntityType.TASK && existing.taskId) {
        await tx.taskHistory.create({
          data: {
            taskId: existing.taskId,
            userId,
            action: AuditAction.UPDATE,
            oldValue: {
              commentId,
              content: existing.content,
            } as Prisma.InputJsonObject,
            newValue: {
              commentId,
              content: newContent,
            } as Prisma.InputJsonObject,
          },
        });
      } else if (
        existing.entityType === CommentEntityType.ISSUE &&
        existing.issueId
      ) {
        await tx.issueHistory.create({
          data: {
            issueId: existing.issueId,
            userId,
            action: AuditAction.UPDATE,
            oldValue: {
              commentId,
              content: existing.content,
            } as Prisma.InputJsonObject,
            newValue: {
              commentId,
              content: newContent,
            } as Prisma.InputJsonObject,
          },
        });
      }

      return res;
    });

    if (projectId) {
      this.eventsGateway?.emitCommentUpdated(
        projectId,
        updated,
        clientMutationId,
      );
    }

    return updated;
  }

  async delete(commentId: string, userId: string, clientMutationId?: string) {
    const existing = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: this.commentInclude,
    });

    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const projectId = existing.task?.projectId ?? existing.issue?.projectId;

    if (!projectId) {
      throw new NotFoundException('Project relation not found');
    }

    const member = await this.projectsService.assertProjectMember(
      projectId,
      userId,
    );

    const isAuthor = existing.userId === userId;
    const isModerator =
      (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
      member.projectRole === ProjectRole.PROJECT_MANAGER ||
      member.projectRole === ProjectRole.TEAM_LEAD;

    if (!isAuthor && !isModerator) {
      throw new ForbiddenException(
        'You do not have permission to delete this comment',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.comment.delete({
        where: { id: commentId },
      });

      if (existing.entityType === CommentEntityType.TASK && existing.taskId) {
        await tx.taskHistory.create({
          data: {
            taskId: existing.taskId,
            userId,
            action: AuditAction.DELETE,
            oldValue: {
              commentId,
              content: existing.content,
              deletedByModerator: !isAuthor,
            } as Prisma.InputJsonObject,
          },
        });
      } else if (
        existing.entityType === CommentEntityType.ISSUE &&
        existing.issueId
      ) {
        await tx.issueHistory.create({
          data: {
            issueId: existing.issueId,
            userId,
            action: AuditAction.DELETE,
            oldValue: {
              commentId,
              content: existing.content,
              deletedByModerator: !isAuthor,
            } as Prisma.InputJsonObject,
          },
        });
      }

      return {
        message: 'Comment deleted successfully',
        commentId,
      };
    });

    this.eventsGateway?.emitCommentDeleted(projectId, {
      commentId,
      entityType: existing.entityType,
      taskId: existing.taskId,
      issueId: existing.issueId,
      deletedBy: userId,
      clientMutationId,
    });

    return result;
  }

  async getTaskHistory(
    taskId: string,
    userId: string,
    query?: HistoryQueryDto,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.projectsService.assertProjectMember(task.projectId, userId);

    const whereClause: Prisma.TaskHistoryWhereInput = {
      taskId,
    };

    if (query?.action) {
      whereClause.action = query.action;
    }

    if (query?.userId) {
      whereClause.userId = query.userId;
    }

    const { page, limit, skip } = getPaginationOffset(
      query?.page,
      query?.limit,
    );
    const sortOrder = query?.sortOrder ?? 'desc';

    const [total, histories] = await this.prisma.$transaction([
      this.prisma.taskHistory.count({ where: whereClause }),
      this.prisma.taskHistory.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: sortOrder,
        },
        include: {
          user: this.userSelect,
        },
      }),
    ]);

    return buildPaginatedResponse(histories, total, page, limit);
  }

  async getIssueHistory(
    issueId: string,
    userId: string,
    query?: HistoryQueryDto,
  ) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    await this.projectsService.assertProjectMember(issue.projectId, userId);

    const whereClause: Prisma.IssueHistoryWhereInput = {
      issueId,
    };

    if (query?.action) {
      whereClause.action = query.action;
    }

    if (query?.userId) {
      whereClause.userId = query.userId;
    }

    const { page, limit, skip } = getPaginationOffset(
      query?.page,
      query?.limit,
    );
    const sortOrder = query?.sortOrder ?? 'desc';

    const [total, histories] = await this.prisma.$transaction([
      this.prisma.issueHistory.count({ where: whereClause }),
      this.prisma.issueHistory.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: sortOrder,
        },
        include: {
          user: this.userSelect,
        },
      }),
    ]);

    return buildPaginatedResponse(histories, total, page, limit);
  }

  async recordIssueHistory(
    issueId: string,
    userId: string,
    action: AuditAction,
    oldValue?: Prisma.InputJsonObject,
    newValue?: Prisma.InputJsonObject,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.issueHistory.create({
      data: {
        issueId,
        userId,
        action,
        oldValue,
        newValue,
      },
    });
  }

  async recordTaskHistory(
    taskId: string,
    userId: string,
    action: AuditAction,
    oldValue?: Prisma.InputJsonObject,
    newValue?: Prisma.InputJsonObject,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.taskHistory.create({
      data: {
        taskId,
        userId,
        action,
        oldValue,
        newValue,
      },
    });
  }
}
