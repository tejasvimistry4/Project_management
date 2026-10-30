import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  MilestoneStatus,
  Notification,
  NotificationType,
  Prisma,
  ProjectRole,
  TaskStatus,
} from '@prisma/client';

import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginatedResponse } from '../../helpers/pagination.helper';
import { SocketGateway } from '../websockets/socket.gateway';
import { getPaginationOffset } from '../../utils/pagination.util';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private deadlineCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly redisService?: RedisService,
    @Optional()
    @Inject(forwardRef(() => SocketGateway))
    private readonly socketGateway?: SocketGateway,
  ) {}

  onModuleInit(): void {
    this.deadlineCheckInterval = setInterval(
      () => {
        void this.checkApproachingAndOverdueDeadlines().catch((err) => {
          this.logger.warn(`Automated deadline check failed: ${err.message}`);
        });
      },
      60 * 60 * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.deadlineCheckInterval) {
      clearInterval(this.deadlineCheckInterval);
      this.deadlineCheckInterval = null;
    }
  }

  private getUnreadCountCacheKey(userId: string): string {
    return `cache:notifications:unread-count:${userId}`;
  }

  private async invalidateUnreadCount(userId: string): Promise<void> {
    if (!userId || !this.redisService) return;
    try {
      await this.redisService.del(this.getUnreadCountCacheKey(userId));
    } catch (err: any) {
      this.logger.warn(
        `Failed to invalidate unread count cache for user ${userId}: ${err.message}`,
      );
    }
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        payload: dto.payload
          ? (dto.payload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    void this.invalidateUnreadCount(dto.userId);

    try {
      this.socketGateway?.emitNotification(dto.userId, notification);
    } catch (err: any) {
      this.logger.debug(`Socket notification emit skipped: ${err.message}`);
    }

    return notification;
  }

  async findAll(userId: string, query: QueryNotificationsDto) {
    const { page, limit, skip } = getPaginationOffset(query.page, query.limit);

    const where: Prisma.NotificationWhereInput = {
      userId,
    };

    if (query.isRead === true) {
      where.readAt = { not: null };
    } else if (query.isRead === false) {
      where.readAt = null;
    }

    if (query.type) {
      where.type = query.type;
    }

    const [total, notifications] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return buildPaginatedResponse(notifications, total, page, limit);
  }

  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const cacheKey = this.getUnreadCountCacheKey(userId);

    if (this.redisService && this.redisService.isHealthy()) {
      return this.redisService.getOrSet(
        cacheKey,
        async () => {
          const count = await this.prisma.notification.count({
            where: { userId, readAt: null },
          });
          return { unreadCount: count };
        },
        300,
      );
    }

    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount: count };
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.readAt) {
      return notification;
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    void this.invalidateUnreadCount(userId);

    return updated;
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    void this.invalidateUnreadCount(userId);

    return { updatedCount: result.count };
  }

  async delete(
    id: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id },
    });

    void this.invalidateUnreadCount(userId);

    return { success: true, message: 'Notification deleted successfully' };
  }

  async deleteAllRead(userId: string): Promise<{ deletedCount: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        userId,
        readAt: { not: null },
      },
    });

    return { deletedCount: result.count };
  }

  async notifyTaskAssigned(
    task: { id: string; title: string; projectId: string; assigneeId: string },
    assignedBy: { id: string; name: string },
  ): Promise<void> {
    if (!task.assigneeId || task.assigneeId === assignedBy.id) {
      return;
    }

    try {
      await this.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task Assigned',
        message: `You have been assigned to task "${task.title}" by ${assignedBy.name}.`,
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          assignedById: assignedBy.id,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to create task assigned notification: ${err.message}`,
      );
    }
  }

  async notifyIssueAssigned(
    issue: { id: string; title: string; projectId: string; assigneeId: string },
    assignedBy: { id: string; name: string },
  ): Promise<void> {
    if (!issue.assigneeId || issue.assigneeId === assignedBy.id) {
      return;
    }

    try {
      await this.create({
        userId: issue.assigneeId,
        type: NotificationType.ISSUE_ASSIGNED,
        title: 'Issue Assigned',
        message: `You have been assigned to issue "${issue.title}" by ${assignedBy.name}.`,
        payload: {
          issueId: issue.id,
          projectId: issue.projectId,
          assignedById: assignedBy.id,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to create issue assigned notification: ${err.message}`,
      );
    }
  }

  async notifyIssueUpdated(
    issue: {
      id: string;
      title: string;
      projectId: string;
      assigneeId?: string | null;
      reporterId: string;
    },
    updatedBy: { id: string; name: string },
    changedFields: Record<string, any>,
  ): Promise<void> {
    const recipientIds = new Set<string>();

    if (issue.assigneeId && issue.assigneeId !== updatedBy.id) {
      recipientIds.add(issue.assigneeId);
    }
    if (issue.reporterId && issue.reporterId !== updatedBy.id) {
      recipientIds.add(issue.reporterId);
    }

    const changedNames = Object.keys(changedFields).join(', ');
    const message = changedNames
      ? `Issue "${issue.title}" was updated (${changedNames}) by ${updatedBy.name}.`
      : `Issue "${issue.title}" was updated by ${updatedBy.name}.`;

    for (const recipientId of recipientIds) {
      try {
        await this.create({
          userId: recipientId,
          type: NotificationType.ISSUE_UPDATED,
          title: 'Issue Updated',
          message,
          payload: {
            issueId: issue.id,
            projectId: issue.projectId,
            updatedById: updatedBy.id,
            changedFields,
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `Failed to create issue updated notification: ${err.message}`,
        );
      }
    }
  }

  async checkApproachingAndOverdueDeadlines(): Promise<{
    tasksChecked: number;
    milestonesChecked: number;
    notificationsCreated: number;
  }> {
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const next48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let notificationsCreated = 0;

    const tasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        dueDate: { not: null, lte: next24h },
        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
        assigneeId: { not: null },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        projectId: true,
        assigneeId: true,
      },
    });

    for (const task of tasks) {
      if (!task.assigneeId || !task.dueDate) continue;

      const isOverdue = task.dueDate < now;
      const title = isOverdue ? 'Task Overdue' : 'Task Deadline Approaching';
      const message = isOverdue
        ? `Task "${task.title}" was due on ${task.dueDate.toISOString().split('T')[0]} and is currently overdue.`
        : `Task "${task.title}" is due soon on ${task.dueDate.toISOString().split('T')[0]}.`;

      const existingNotification = await this.prisma.notification.findFirst({
        where: {
          userId: task.assigneeId,
          type: NotificationType.DEADLINE_APPROACHING,
          createdAt: { gte: last24h },
          payload: {
            path: ['taskId'],
            equals: task.id,
          },
        },
      });

      if (!existingNotification) {
        await this.create({
          userId: task.assigneeId,
          type: NotificationType.DEADLINE_APPROACHING,
          title,
          message,
          payload: {
            taskId: task.id,
            projectId: task.projectId,
            isOverdue,
            dueDate: task.dueDate.toISOString(),
          },
        });
        notificationsCreated++;
      }
    }

    const milestones = await this.prisma.milestone.findMany({
      where: {
        dueDate: { not: null, lte: next48h },
        status: {
          notIn: [MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED],
        },
      },
      include: {
        project: {
          include: {
            members: {
              where: {
                projectRole: {
                  in: [ProjectRole.PROJECT_MANAGER, ProjectRole.TEAM_LEAD],
                },
              },
              select: { userId: true },
            },
          },
        },
      },
    });

    for (const milestone of milestones) {
      if (!milestone.dueDate) continue;

      const isOverdue = milestone.dueDate < now;
      const title = isOverdue
        ? 'Milestone Overdue'
        : 'Milestone Deadline Approaching';
      const message = isOverdue
        ? `Milestone "${milestone.name}" in project "${milestone.project.name}" was due on ${milestone.dueDate.toISOString().split('T')[0]} and is overdue.`
        : `Milestone "${milestone.name}" in project "${milestone.project.name}" is due soon on ${milestone.dueDate.toISOString().split('T')[0]}.`;

      for (const member of milestone.project.members) {
        const existingNotification = await this.prisma.notification.findFirst({
          where: {
            userId: member.userId,
            type: NotificationType.DEADLINE_APPROACHING,
            createdAt: { gte: last24h },
            payload: {
              path: ['milestoneId'],
              equals: milestone.id,
            },
          },
        });

        if (!existingNotification) {
          await this.create({
            userId: member.userId,
            type: NotificationType.DEADLINE_APPROACHING,
            title,
            message,
            payload: {
              milestoneId: milestone.id,
              projectId: milestone.projectId,
              isOverdue,
              dueDate: milestone.dueDate.toISOString(),
            },
          });
          notificationsCreated++;
        }
      }
    }

    return {
      tasksChecked: tasks.length,
      milestonesChecked: milestones.length,
      notificationsCreated,
    };
  }
}
