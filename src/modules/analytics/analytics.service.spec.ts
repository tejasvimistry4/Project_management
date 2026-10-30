import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  IssueStatus,
  MilestoneStatus,
  ProjectRole,
  TaskPriority,
  TaskStatus,
  TimesheetStatus,
} from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let projectsService: ProjectsService;
  let redisService: RedisService;

  const mockPrisma = {
    project: {
      findUnique: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    issue: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    milestone: {
      findMany: jest.fn(),
    },
    timeEntry: {
      findMany: jest.fn(),
    },
    projectMember: {
      findMany: jest.fn(),
    },
  };

  const mockProjectsService = {
    assertProjectMember: jest.fn().mockResolvedValue(true),
  };

  const mockRedisService = {
    getOrSet: jest.fn().mockImplementation((key, fetchFn) => fetchFn()),
    isHealthy: jest.fn().mockReturnValue(true),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'redis.ttl.dashboard') return 300;
      if (key === 'redis.ttl.reports') return 600;
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    projectsService = module.get<ProjectsService>(ProjectsService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProjectDashboard', () => {
    it('should assert membership and call redis getOrSet with cache key and ttl', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        id: 'proj-1',
        name: 'Alpha',
        description: 'Alpha project',
        status: 'ACTIVE',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        organizationId: 'org-1',
        _count: { members: 3 },
      });

      mockPrisma.task.findMany.mockResolvedValueOnce([
        {
          id: 't1',
          status: TaskStatus.DONE,
          priority: TaskPriority.HIGH,
          dueDate: null,
        },
        {
          id: 't2',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.MEDIUM,
          dueDate: new Date('2026-01-01'),
        },
      ]);

      mockPrisma.issue.findMany.mockResolvedValueOnce([
        { id: 'i1', status: IssueStatus.OPEN },
        { id: 'i2', status: IssueStatus.RESOLVED },
      ]);

      mockPrisma.milestone.findMany.mockResolvedValueOnce([
        { id: 'm1', status: MilestoneStatus.COMPLETED, dueDate: null },
      ]);

      mockPrisma.timeEntry.findMany.mockResolvedValueOnce([
        { hours: 5.5, status: TimesheetStatus.APPROVED },
        { hours: 2.5, status: TimesheetStatus.SUBMITTED },
      ]);

      const result = await service.getProjectDashboard('proj-1', 'usr-1');

      expect(projectsService.assertProjectMember).toHaveBeenCalledWith(
        'proj-1',
        'usr-1',
      );
      expect(redisService.getOrSet).toHaveBeenCalledWith(
        'cache:dashboard:proj-1',
        expect.any(Function),
        300,
      );

      expect(result.project.name).toBe('Alpha');
      expect(result.project.membersCount).toBe(3);
      expect(result.tasks.total).toBe(2);
      expect(result.tasks.completed).toBe(1);
      expect(result.tasks.completionPercentage).toBe(50);
      expect(result.issues.total).toBe(2);
      expect(result.issues.open).toBe(1);
      expect(result.issues.resolved).toBe(1);
      expect(result.milestones.completed).toBe(1);
      expect(result.timeTracking.totalHours).toBe(8);
      expect(result.timeTracking.approvedHours).toBe(5.5);
      expect(result.timeTracking.pendingHours).toBe(2.5);
    });

    it('should throw NotFoundException if project is missing', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getProjectDashboard('proj-404', 'usr-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProjectWorkload', () => {
    it('should compute workload and assign correct status indicators', async () => {
      mockPrisma.projectMember.findMany.mockResolvedValueOnce([
        {
          userId: 'usr-heavy',
          projectRole: ProjectRole.DEVELOPER,
          user: { id: 'usr-heavy', name: 'Busy Bee', email: 'busy@test.com' },
        },
        {
          userId: 'usr-light',
          projectRole: ProjectRole.VIEWER,
          user: { id: 'usr-light', name: 'Chill Cat', email: 'chill@test.com' },
        },
      ]);

      mockPrisma.task.findMany.mockResolvedValueOnce([
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.IN_PROGRESS },
      ]);
      mockPrisma.issue.count.mockResolvedValueOnce(2);
      mockPrisma.timeEntry.findMany.mockResolvedValueOnce([
        { hours: 40, status: TimesheetStatus.APPROVED },
        { hours: 10, status: TimesheetStatus.APPROVED },
      ]);

      mockPrisma.task.findMany.mockResolvedValueOnce([
        { status: TaskStatus.IN_PROGRESS },
      ]);
      mockPrisma.issue.count.mockResolvedValueOnce(0);
      mockPrisma.timeEntry.findMany.mockResolvedValueOnce([
        { hours: 5, status: TimesheetStatus.APPROVED },
      ]);

      const result = await service.getProjectWorkload('proj-1', 'usr-leader');

      expect(projectsService.assertProjectMember).toHaveBeenCalledWith(
        'proj-1',
        'usr-leader',
      );
      expect(redisService.getOrSet).toHaveBeenCalledWith(
        'cache:workload:proj-1',
        expect.any(Function),
        600,
      );

      expect(result.members.length).toBe(2);
      expect(result.members[0].workloadStatus).toBe('OVERLOADED');
      expect(result.members[0].totalLoggedHours).toBe(50);
      expect(result.members[1].workloadStatus).toBe('LIGHT');
      expect(result.members[1].totalLoggedHours).toBe(5);
    });
  });
});
