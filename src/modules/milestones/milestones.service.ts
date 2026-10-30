import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  MilestoneStatus,
  OrganizationRole,
  Prisma,
  ProjectRole,
  TaskStatus,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CacheInvalidationService } from '../../common/redis/cache-invalidation.service';
import { buildPaginatedResponse } from '../../helpers';
import {
  calculateDaysOverdue,
  getPaginationOffset,
  validateDateRange,
} from '../../utils';
import { ProjectsService } from '../projects/projects.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { LinkMilestoneTasksDto } from './dto/link-milestone-tasks.dto';
import {
  MilestoneQueryDto,
  MilestoneSortBy,
  SortOrder,
} from './dto/milestone-query.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';

export interface MilestoneProgressMetrics {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  completionPercentage: number;
  isOverdue: boolean;
  daysOverdue: number;
  tasksByStatus: Record<TaskStatus, number>;
}

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Optional()
    private readonly cacheInvalidationService?: CacheInvalidationService,
  ) {}

  private readonly milestoneInclude = {
    project: {
      select: {
        id: true,
        name: true,
        organizationId: true,
        status: true,
      },
    },
    tasks: {
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            deletedAt: true,
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    },
    _count: {
      select: {
        tasks: true,
      },
    },
  };

  private validateDates(
    startDate?: string | Date | null,
    dueDate?: string | Date | null,
  ): void {
    validateDateRange(
      startDate,
      dueDate,
      'Start date cannot be after due date',
    );
  }

  private computeMetrics(milestone: {
    startDate?: Date | null;
    dueDate?: Date | null;
    status: MilestoneStatus;
    tasks?: {
      task: {
        id: string;
        status: TaskStatus;
        deletedAt?: Date | null;
      };
    }[];
  }): MilestoneProgressMetrics {
    const activeTasks =
      milestone.tasks
        ?.map((mt) => mt.task)
        .filter((t) => t.deletedAt === null) || [];

    const totalTasks = activeTasks.length;
    const completedTasks = activeTasks.filter(
      (t) => t.status === TaskStatus.DONE,
    ).length;
    const pendingTasks = totalTasks - completedTasks;
    const completionPercentage =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const tasksByStatus: Record<TaskStatus, number> = {
      [TaskStatus.TODO]: 0,
      [TaskStatus.IN_PROGRESS]: 0,
      [TaskStatus.IN_REVIEW]: 0,
      [TaskStatus.BLOCKED]: 0,
      [TaskStatus.DONE]: 0,
      [TaskStatus.CANCELLED]: 0,
    };

    for (const t of activeTasks) {
      if (tasksByStatus[t.status] !== undefined) {
        tasksByStatus[t.status]++;
      }
    }

    const isResolvedOrCancelled =
      milestone.status === MilestoneStatus.COMPLETED ||
      milestone.status === MilestoneStatus.CANCELLED;

    const { isOverdue, daysOverdue } = calculateDaysOverdue(
      milestone.dueDate,
      isResolvedOrCancelled,
    );

    return {
      totalTasks,
      completedTasks,
      pendingTasks,
      completionPercentage,
      isOverdue,
      daysOverdue,
      tasksByStatus,
    };
  }

  private formatMilestone<
    T extends {
      startDate?: Date | null;
      dueDate?: Date | null;
      status: MilestoneStatus;
      tasks?: {
        task: {
          id: string;
          status: TaskStatus;
          deletedAt?: Date | null;
        };
      }[];
    },
  >(milestone: T) {
    const progress = this.computeMetrics(milestone);
    return {
      ...milestone,
      progress,
    };
  }

  async create(userId: string, dto: CreateMilestoneDto) {
    this.validateDates(dto.startDate, dto.dueDate);

    await this.projectsService.assertProjectRole(dto.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const milestone = await this.prisma.milestone.create({
      data: {
        projectId: dto.projectId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: dto.status ?? MilestoneStatus.PLANNED,
      },
      include: this.milestoneInclude,
    });

    void this.cacheInvalidationService?.invalidateMilestone(dto.projectId);

    return this.formatMilestone(milestone);
  }

  async findAll(userId: string, query: MilestoneQueryDto) {
    if (query.projectId) {
      await this.projectsService.assertProjectMember(query.projectId, userId);
    }

    const whereClause: Prisma.MilestoneWhereInput = {};

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

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.search) {
      whereClause.OR = [
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
      ];
    }

    if (query.isOverdue === true) {
      whereClause.dueDate = { lt: new Date() };
      whereClause.status = {
        notIn: [MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED],
      };
    } else if (query.isOverdue === false) {
      whereClause.OR = [
        { dueDate: null },
        { dueDate: { gte: new Date() } },
        {
          status: {
            in: [MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED],
          },
        },
      ];
    }

    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);
    const sortBy = query.sortBy ?? MilestoneSortBy.DUE_DATE;
    const sortOrder = query.sortOrder ?? SortOrder.ASC;

    const [total, milestones] = await this.prisma.$transaction([
      this.prisma.milestone.count({ where: whereClause }),
      this.prisma.milestone.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: this.milestoneInclude,
      }),
    ]);

    const formatted = milestones.map((m) => this.formatMilestone(m));
    return buildPaginatedResponse(formatted, total, page, limit);
  }

  async findById(milestoneId: string, userId: string) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: this.milestoneInclude,
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    await this.projectsService.assertProjectMember(milestone.projectId, userId);

    return this.formatMilestone(milestone);
  }

  async update(milestoneId: string, userId: string, dto: UpdateMilestoneDto) {
    const existing = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });

    if (!existing) {
      throw new NotFoundException('Milestone not found');
    }

    await this.projectsService.assertProjectRole(existing.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const newStartDate =
      dto.startDate !== undefined ? dto.startDate : existing.startDate;
    const newDueDate =
      dto.dueDate !== undefined ? dto.dueDate : existing.dueDate;

    this.validateDates(newStartDate, newDueDate);

    const updated = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        description:
          dto.description !== undefined ? dto.description?.trim() : undefined,
        startDate:
          dto.startDate !== undefined
            ? dto.startDate
              ? new Date(dto.startDate)
              : null
            : undefined,
        dueDate:
          dto.dueDate !== undefined
            ? dto.dueDate
              ? new Date(dto.dueDate)
              : null
            : undefined,
        status: dto.status !== undefined ? dto.status : undefined,
      },
      include: this.milestoneInclude,
    });

    void this.cacheInvalidationService?.invalidateMilestone(existing.projectId);

    return this.formatMilestone(updated);
  }

  async delete(milestoneId: string, userId: string) {
    const existing = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });

    if (!existing) {
      throw new NotFoundException('Milestone not found');
    }

    await this.projectsService.assertProjectRole(existing.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    await this.prisma.milestone.delete({
      where: { id: milestoneId },
    });

    void this.cacheInvalidationService?.invalidateMilestone(existing.projectId);

    return {
      message: 'Milestone deleted successfully',
      milestoneId,
    };
  }

  async linkTasks(
    milestoneId: string,
    userId: string,
    dto: LinkMilestoneTasksDto,
  ) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    await this.projectsService.assertProjectRole(milestone.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const taskIds = new Set<string>();
    if (dto.taskIds && dto.taskIds.length > 0) {
      dto.taskIds.forEach((id) => taskIds.add(id));
    }
    if (dto.taskId) {
      taskIds.add(dto.taskId);
    }

    if (taskIds.size === 0) {
      throw new BadRequestException(
        'At least one taskId must be provided to link to the milestone',
      );
    }

    const targetTaskIds = Array.from(taskIds);

    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: targetTaskIds },
        deletedAt: null,
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (tasks.length !== targetTaskIds.length) {
      throw new BadRequestException(
        'One or more tasks were not found or have been deleted',
      );
    }

    const foreignTask = tasks.find((t) => t.projectId !== milestone.projectId);
    if (foreignTask) {
      throw new BadRequestException(
        'All linked tasks must belong to the same project as the milestone',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const taskId of targetTaskIds) {
        await tx.milestoneTask.upsert({
          where: {
            milestoneId_taskId: {
              milestoneId,
              taskId,
            },
          },
          create: {
            milestoneId,
            taskId,
          },
          update: {},
        });
      }
    });

    void this.cacheInvalidationService?.invalidateMilestone(
      milestone.projectId,
    );

    return this.findById(milestoneId, userId);
  }

  async unlinkTask(milestoneId: string, taskId: string, userId: string) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    await this.projectsService.assertProjectRole(milestone.projectId, userId, [
      ProjectRole.PROJECT_MANAGER,
      ProjectRole.TEAM_LEAD,
    ]);

    const relation = await this.prisma.milestoneTask.findUnique({
      where: {
        milestoneId_taskId: {
          milestoneId,
          taskId,
        },
      },
    });

    if (!relation) {
      throw new NotFoundException('Task is not linked to this milestone');
    }

    await this.prisma.milestoneTask.delete({
      where: {
        milestoneId_taskId: {
          milestoneId,
          taskId,
        },
      },
    });

    void this.cacheInvalidationService?.invalidateMilestone(
      milestone.projectId,
    );

    return {
      message: 'Task unlinked successfully from milestone',
      milestoneId,
      taskId,
    };
  }
}
