import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../database/prisma.service';
import { SocketGateway } from '../websockets/socket.gateway';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockSocketGateway: any;

  beforeEach(async () => {
    mockPrisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      task: {
        findMany: jest.fn(),
      },
      milestone: {
        findMany: jest.fn(),
      },
    };

    mockRedis = {
      isHealthy: jest.fn().mockReturnValue(true),
      getOrSet: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };

    mockSocketGateway = {
      emitNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: SocketGateway, useValue: mockSocketGateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create notification in PostgreSQL, invalidate Redis unread count, and emit socket event', async () => {
      const createdNotification = {
        id: 'notif-1',
        userId: 'user-1',
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task Assigned',
        message: 'You have been assigned to task "Fix Bug".',
        payload: { taskId: 'task-1' },
        readAt: null,
        createdAt: new Date(),
      };

      mockPrisma.notification.create.mockResolvedValueOnce(createdNotification);

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task Assigned',
        message: 'You have been assigned to task "Fix Bug".',
        payload: { taskId: 'task-1' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task Assigned',
          message: 'You have been assigned to task "Fix Bug".',
          payload: { taskId: 'task-1' },
        },
      });

      expect(mockRedis.del).toHaveBeenCalledWith(
        'cache:notifications:unread-count:user-1',
      );
      expect(mockSocketGateway.emitNotification).toHaveBeenCalledWith(
        'user-1',
        createdNotification,
      );
      expect(result).toEqual(createdNotification);
    });
  });

  describe('findAll', () => {
    it('should return paginated notifications strictly scoped to authenticated user', async () => {
      const notifications = [
        { id: 'n1', userId: 'user-1', title: 'N1', readAt: null },
        { id: 'n2', userId: 'user-1', title: 'N2', readAt: new Date() },
      ];

      mockPrisma.notification.count.mockResolvedValueOnce(2);
      mockPrisma.notification.findMany.mockResolvedValueOnce(notifications);

      const result = await service.findAll('user-1', { page: 1, limit: 10 });

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.data).toEqual(notifications);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
    });

    it('should filter by unread status (isRead: false)', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(1);
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);

      await service.findAll('user-1', { page: 1, limit: 10, isRead: false });

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });

    it('should filter by read status (isRead: true)', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(1);
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);

      await service.findAll('user-1', { page: 1, limit: 10, isRead: true });

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: { not: null } },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return cached count using Redis getOrSet when Redis is healthy', async () => {
      mockRedis.getOrSet.mockResolvedValueOnce({ unreadCount: 5 });

      const result = await service.getUnreadCount('user-1');

      expect(mockRedis.getOrSet).toHaveBeenCalledWith(
        'cache:notifications:unread-count:user-1',
        expect.any(Function),
        300,
      );
      expect(result).toEqual({ unreadCount: 5 });
    });

    it('should fall back to Prisma count directly when Redis is unhealthy', async () => {
      mockRedis.isHealthy.mockReturnValue(false);
      mockPrisma.notification.count.mockResolvedValueOnce(3);

      const result = await service.getUnreadCount('user-1');

      expect(mockRedis.getOrSet).not.toHaveBeenCalled();
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
      expect(result).toEqual({ unreadCount: 3 });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read and invalidate Redis cache', async () => {
      const existing = { id: 'n1', userId: 'user-1', readAt: null };
      const updated = { ...existing, readAt: new Date() };

      mockPrisma.notification.findUnique.mockResolvedValueOnce(existing);
      mockPrisma.notification.update.mockResolvedValueOnce(updated);

      const result = await service.markAsRead('n1', 'user-1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt: expect.any(Date) },
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        'cache:notifications:unread-count:user-1',
      );
      expect(result.readAt).toBeDefined();
    });

    it('should throw NotFoundException if notification belongs to another user', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'different-user',
      });

      await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read and invalidate Redis cache', async () => {
      mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 4 });

      const result = await service.markAllAsRead('user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        'cache:notifications:unread-count:user-1',
      );
      expect(result).toEqual({ updatedCount: 4 });
    });
  });

  describe('delete and deleteAllRead', () => {
    it('should delete notification if user is owner', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'user-1',
      });
      mockPrisma.notification.delete.mockResolvedValueOnce({ id: 'n1' });

      const result = await service.delete('n1', 'user-1');

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'n1' },
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        'cache:notifications:unread-count:user-1',
      );
      expect(result.success).toBe(true);
    });

    it('should throw NotFoundException when deleting notification of another user', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'other-user',
      });

      await expect(service.delete('n1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete all read notifications', async () => {
      mockPrisma.notification.deleteMany.mockResolvedValueOnce({ count: 7 });

      const result = await service.deleteAllRead('user-1');

      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: { not: null } },
      });
      expect(result).toEqual({ deletedCount: 7 });
    });
  });

  describe('Domain Event Generators', () => {
    it('should notify user when task is assigned by another user', async () => {
      mockPrisma.notification.create.mockResolvedValueOnce({});

      await service.notifyTaskAssigned(
        { id: 't1', title: 'Design API', projectId: 'p1', assigneeId: 'dev-1' },
        { id: 'lead-1', name: 'Lead Alice' },
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'dev-1',
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task Assigned',
        }),
      });
    });

    it('should not notify user if they assigned task to themselves', async () => {
      await service.notifyTaskAssigned(
        { id: 't1', title: 'Self Task', projectId: 'p1', assigneeId: 'user-1' },
        { id: 'user-1', name: 'Me' },
      );

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('should notify assignee when issue is assigned', async () => {
      mockPrisma.notification.create.mockResolvedValueOnce({});

      await service.notifyIssueAssigned(
        {
          id: 'i1',
          title: 'Crash on login',
          projectId: 'p1',
          assigneeId: 'dev-2',
        },
        { id: 'tester-1', name: 'Tester Bob' },
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'dev-2',
          type: NotificationType.ISSUE_ASSIGNED,
        }),
      });
    });

    it('should notify assignee and reporter on issue updates, excluding updater', async () => {
      mockPrisma.notification.create.mockResolvedValue({});

      await service.notifyIssueUpdated(
        {
          id: 'i1',
          title: 'Database connection drop',
          projectId: 'p1',
          assigneeId: 'dev-1',
          reporterId: 'qa-1',
        },
        { id: 'manager-1', name: 'Manager Dave' },
        { status: 'RESOLVED' },
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkApproachingAndOverdueDeadlines', () => {
    it('should generate notifications for approaching and overdue deadlines with deduplication', async () => {
      const now = new Date();
      const overdueDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      mockPrisma.task.findMany.mockResolvedValueOnce([
        {
          id: 'task-overdue',
          title: 'Late Task',
          dueDate: overdueDate,
          projectId: 'p1',
          assigneeId: 'dev-1',
        },
      ]);

      mockPrisma.milestone.findMany.mockResolvedValueOnce([
        {
          id: 'm-overdue',
          name: 'Q1 Release',
          dueDate: overdueDate,
          projectId: 'p1',
          project: {
            name: 'Core Platform',
            members: [{ userId: 'lead-1' }],
          },
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.checkApproachingAndOverdueDeadlines();

      expect(result.tasksChecked).toBe(1);
      expect(result.milestonesChecked).toBe(1);
      expect(result.notificationsCreated).toBe(2);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    });

    it('should skip creating duplicate notification if already sent within 24h', async () => {
      const now = new Date();
      const overdueDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      mockPrisma.task.findMany.mockResolvedValueOnce([
        {
          id: 'task-overdue',
          title: 'Late Task',
          dueDate: overdueDate,
          projectId: 'p1',
          assigneeId: 'dev-1',
        },
      ]);
      mockPrisma.milestone.findMany.mockResolvedValueOnce([]);

      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'existing-notif',
      });

      const result = await service.checkApproachingAndOverdueDeadlines();

      expect(result.notificationsCreated).toBe(0);
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });
});
