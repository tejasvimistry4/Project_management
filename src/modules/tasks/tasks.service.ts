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
  OrganizationRole,
  Prisma,
  ProjectRole,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CacheInvalidationService } from '../../common/redis/cache-invalidation.service';
import { assertProjectAssignee, buildPaginatedResponse } from '../../helpers';
import { getPaginationOffset } from '../../utils';
import { ProjectsService } from '../projects/projects.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Optional()
    private readonly cacheInvalidationService?: CacheInvalidationService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService?: NotificationsService,
  ) {}

  private readonly taskInclude = {
    assignee: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    },
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
        timeEntries: true,
        histories: true,
      },
    },
  };

  async create(userId: string, dto: CreateTaskDto) {
    const member = await this.projectsService.assertProjectMember(
      dto.projectId,
      userId,
    );

    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException(
        'Viewers do not have permission to create tasks',
      );
    }

    if (dto.assigneeId) {
      await assertProjectAssignee(this.prisma, dto.projectId, dto.assigneeId);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          projectId: dto.projectId,
          title: dto.title,
          description: dto.description,
          status: dto.status ?? TaskStatus.TODO,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          assigneeId: dto.assigneeId ?? null,
        },
        include: this.taskInclude,
      });

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          userId,
          action: AuditAction.CREATE,
          newValue: {
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate ? task.dueDate.toISOString() : null,
            assigneeId: task.assigneeId,
          },
        },
      });

      if (task.assigneeId) {
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            userId,
            action: AuditAction.ASSIGN,
            newValue: {
              assigneeId: task.assigneeId,
            },
          },
        });
      }

      return task;
    });

    void this.cacheInvalidationService?.invalidateTask(dto.projectId);

    if (result.assigneeId) {
      void this.prisma.user
        .findUnique({
          where: { id: userId },
          select: { name: true },
        })
        .then((actor) => {
          void this.notificationsService?.notifyTaskAssigned(
            {
              id: result.id,
              title: result.title,
              projectId: result.projectId,
              assigneeId: result.assigneeId!,
            },
            { id: userId, name: actor?.name || 'A team member' },
          );
        });
    }

    return result;
  }

  async findAll(userId: string, query: TaskQueryDto) {
    if (query.projectId) {
      await this.projectsService.assertProjectMember(query.projectId, userId);
    }

    const whereClause: Prisma.TaskWhereInput = {};

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

    if (query.dueDateFrom || query.dueDateTo) {
      whereClause.dueDate = {
        ...(query.dueDateFrom ? { gte: new Date(query.dueDateFrom) } : {}),
        ...(query.dueDateTo ? { lte: new Date(query.dueDateTo) } : {}),
      };
    }

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const [total, tasks] = await this.prisma.$transaction([
      this.prisma.task.count({ where: whereClause }),
      this.prisma.task.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: this.taskInclude,
      }),
    ]);

    return buildPaginatedResponse(tasks, total, page, limit);
  }

  async findById(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.taskInclude,
    });

    if (!task || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    await this.projectsService.assertProjectMember(task.projectId, userId);

    return task;
  }

  async update(taskId: string, userId: string, dto: UpdateTaskDto) {
    const existingTask = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existingTask || existingTask.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    const member = await this.projectsService.assertProjectMember(
      existingTask.projectId,
      userId,
    );

    const isManagerOrLead =
      (member as { isOrgAdmin?: boolean }).isOrgAdmin ||
      member.projectRole === ProjectRole.PROJECT_MANAGER ||
      member.projectRole === ProjectRole.TEAM_LEAD;

    if (member.projectRole === ProjectRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot modify tasks');
    }

    if (!isManagerOrLead) {
      const isAssignee = existingTask.assigneeId === userId;
      if (!isAssignee) {
        throw new ForbiddenException(
          'You do not have permission to modify this task',
        );
      }

      const isAttemptingRestrictedFields =
        dto.title !== undefined ||
        dto.description !== undefined ||
        dto.priority !== undefined ||
        dto.dueDate !== undefined ||
        dto.assigneeId !== undefined;

      if (isAttemptingRestrictedFields) {
        throw new ForbiddenException(
          'Developers are only authorized to update the status of their assigned tasks',
        );
      }
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      await assertProjectAssignee(
        this.prisma,
        existingTask.projectId,
        dto.assigneeId,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.TaskUpdateInput = {};
      const historyCreations: Promise<unknown>[] = [];

      if (dto.status !== undefined && dto.status !== existingTask.status) {
        updateData.status = dto.status;
        if (
          dto.status === TaskStatus.DONE &&
          existingTask.status !== TaskStatus.DONE
        ) {
          updateData.completedAt = new Date();
        } else if (
          dto.status !== TaskStatus.DONE &&
          existingTask.status === TaskStatus.DONE
        ) {
          updateData.completedAt = null;
        }

        historyCreations.push(
          tx.taskHistory.create({
            data: {
              taskId,
              userId,
              action: AuditAction.STATUS_CHANGE,
              oldValue: { status: existingTask.status },
              newValue: { status: dto.status },
            },
          }),
        );
      }

      if (
        dto.assigneeId !== undefined &&
        dto.assigneeId !== existingTask.assigneeId
      ) {
        if (dto.assigneeId === null) {
          updateData.assignee = { disconnect: true };
          historyCreations.push(
            tx.taskHistory.create({
              data: {
                taskId,
                userId,
                action: AuditAction.UNASSIGN,
                oldValue: {
                  assigneeId: existingTask.assigneeId,
                },
              },
            }),
          );
        } else {
          updateData.assignee = {
            connect: { id: dto.assigneeId },
          };
          historyCreations.push(
            tx.taskHistory.create({
              data: {
                taskId,
                userId,
                action: AuditAction.ASSIGN,
                oldValue: {
                  assigneeId: existingTask.assigneeId,
                },
                newValue: {
                  assigneeId: dto.assigneeId,
                },
              },
            }),
          );
        }
      }

      const changedFields: Record<string, Prisma.InputJsonValue | null> = {};
      const oldFields: Record<string, Prisma.InputJsonValue | null> = {};

      if (dto.title !== undefined && dto.title !== existingTask.title) {
        updateData.title = dto.title;
        changedFields.title = dto.title;
        oldFields.title = existingTask.title;
      }

      if (
        dto.description !== undefined &&
        dto.description !== existingTask.description
      ) {
        updateData.description = dto.description;
        changedFields.description = dto.description ?? null;
        oldFields.description = existingTask.description ?? null;
      }

      if (
        dto.priority !== undefined &&
        dto.priority !== existingTask.priority
      ) {
        updateData.priority = dto.priority;
        changedFields.priority = dto.priority;
        oldFields.priority = existingTask.priority;
      }

      if (dto.dueDate !== undefined) {
        const newDueDate = dto.dueDate ? new Date(dto.dueDate) : null;
        const oldDueTime = existingTask.dueDate
          ? new Date(existingTask.dueDate).getTime()
          : null;
        const newDueTime = newDueDate ? newDueDate.getTime() : null;

        if (oldDueTime !== newDueTime) {
          updateData.dueDate = newDueDate;
          changedFields.dueDate = newDueDate ? newDueDate.toISOString() : null;
          oldFields.dueDate = existingTask.dueDate
            ? new Date(existingTask.dueDate).toISOString()
            : null;
        }
      }

      if (Object.keys(changedFields).length > 0) {
        historyCreations.push(
          tx.taskHistory.create({
            data: {
              taskId,
              userId,
              action: AuditAction.UPDATE,
              oldValue: oldFields as Prisma.InputJsonObject,
              newValue: changedFields as Prisma.InputJsonObject,
            },
          }),
        );
      }

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: updateData,
        include: this.taskInclude,
      });

      await Promise.all(historyCreations);

      return updatedTask;
    });

    void this.cacheInvalidationService?.invalidateTask(existingTask.projectId);

    if (dto.assigneeId && dto.assigneeId !== existingTask.assigneeId) {
      void this.prisma.user
        .findUnique({
          where: { id: userId },
          select: { name: true },
        })
        .then((actor) => {
          void this.notificationsService?.notifyTaskAssigned(
            {
              id: result.id,
              title: result.title,
              projectId: result.projectId,
              assigneeId: dto.assigneeId!,
            },
            { id: userId, name: actor?.name || 'A team member' },
          );
        });
    }

    return result;
  }

  async updateStatus(taskId: string, userId: string, status: TaskStatus) {
    return this.update(taskId, userId, { status });
  }

  async assign(taskId: string, userId: string, assigneeId: string | null) {
    return this.update(taskId, userId, { assigneeId });
  }

  async delete(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    await this.projectsService.assertProjectRole(task.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.task.update({
        where: { id: taskId },
        data: {
          deletedAt: new Date(),
        },
      });

      await tx.taskHistory.create({
        data: {
          taskId,
          userId,
          action: AuditAction.DELETE,
          oldValue: {
            id: task.id,
            title: task.title,
          },
        },
      });

      return {
        message: 'Task deleted successfully',
        taskId: deleted.id,
      };
    });

    void this.cacheInvalidationService?.invalidateTask(task.projectId);

    return result;
  }

  async getHistory(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.projectsService.assertProjectMember(task.projectId, userId);

    return this.prisma.taskHistory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }
}
