import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, ProjectRole, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let mockPrisma: any;
  let mockProjectsService: any;

  beforeEach(async () => {
    mockPrisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
    };

    mockProjectsService = {
      assertProjectMember: jest.fn().mockResolvedValue({
        projectRole: ProjectRole.PROJECT_MANAGER,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProjectsService, useValue: mockProjectsService },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('should sanitize metadata, redact passwords/tokens, and insert audit record', async () => {
      const rawMetadata = {
        title: 'New Task',
        password: 'super-secret-password',
        accessToken: 'jwt.token.here',
        refreshToken: 'refresh.token.here',
        description: 'Safe description',
        nested: {
          userSecret: 'secret-val',
          count: 10,
        },
      };

      const expectedRecord = {
        id: 'log-1',
        userId: 'usr-1',
        action: AuditAction.CREATE,
        entityType: 'TASK',
        entityId: 'task-1',
        metadata: {
          title: 'New Task',
          password: '[REDACTED]',
          accessToken: '[REDACTED]',
          refreshToken: '[REDACTED]',
          description: 'Safe description',
          nested: {
            userSecret: '[REDACTED]',
            count: 10,
          },
          projectId: 'proj-1',
          organizationId: 'org-1',
        },
        createdAt: new Date(),
      };

      mockPrisma.auditLog.create.mockResolvedValueOnce(expectedRecord);

      const result = await service.record({
        userId: 'usr-1',
        action: AuditAction.CREATE,
        entityType: 'TASK',
        entityId: 'task-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        metadata: rawMetadata,
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'usr-1',
          action: AuditAction.CREATE,
          entityType: 'TASK',
          entityId: 'task-1',
          metadata: expect.objectContaining({
            title: 'New Task',
            password: '[REDACTED]',
            accessToken: '[REDACTED]',
            refreshToken: '[REDACTED]',
            description: 'Safe description',
            projectId: 'proj-1',
            organizationId: 'org-1',
          }),
        },
      });

      expect(result).toEqual(expectedRecord);
    });

    it('should execute inside transaction client when tx is provided', async () => {
      const mockTx = {
        auditLog: {
          create: jest.fn().mockResolvedValueOnce({ id: 'tx-log-1' }),
        },
      } as any;

      await service.record(
        {
          userId: 'usr-1',
          action: AuditAction.UPDATE,
          entityType: 'PROJECT',
          entityId: 'p-1',
        },
        mockTx,
      );

      expect(mockTx.auditLog.create).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated audit logs for ADMIN', async () => {
      const logs = [
        {
          id: 'l1',
          action: AuditAction.CREATE,
          entityType: 'TASK',
          user: { id: 'u1' },
        },
        {
          id: 'l2',
          action: AuditAction.UPDATE,
          entityType: 'ISSUE',
          user: { id: 'u2' },
        },
      ];

      mockPrisma.auditLog.count.mockResolvedValueOnce(2);
      mockPrisma.auditLog.findMany.mockResolvedValueOnce(logs);

      const result = await service.findAll(
        { page: 1, limit: 10, entityType: 'TASK' },
        'admin-1',
        UserRole.ADMIN,
      );

      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          entityType: { equals: 'TASK', mode: 'insensitive' },
        }),
      });
      expect(result.data).toEqual(logs);
      expect(result.meta.total).toBe(2);
    });

    it('should filter by projectId and verify project access for non-admin', async () => {
      mockPrisma.auditLog.count.mockResolvedValueOnce(1);
      mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

      await service.findAll(
        { page: 1, limit: 10, projectId: 'proj-1' },
        'lead-1',
        UserRole.DEVELOPER,
      );

      expect(mockProjectsService.assertProjectMember).toHaveBeenCalledWith(
        'proj-1',
        'lead-1',
      );
      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          metadata: { path: ['projectId'], equals: 'proj-1' },
        }),
      });
    });

    it('should throw ForbiddenException if viewer attempts to view project audit logs', async () => {
      mockProjectsService.assertProjectMember.mockResolvedValueOnce({
        projectRole: ProjectRole.VIEWER,
      });

      await expect(
        service.findAll(
          { page: 1, limit: 10, projectId: 'proj-1' },
          'viewer-1',
          UserRole.VIEWER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findByEntity', () => {
    it('should return full history for a specific entity', async () => {
      const history = [
        { id: 'l1', action: AuditAction.CREATE },
        { id: 'l2', action: AuditAction.STATUS_CHANGE },
      ];
      mockPrisma.auditLog.findMany.mockResolvedValueOnce(history);

      const result = await service.findByEntity('TASK', 'task-123');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          entityType: 'TASK',
          entityId: 'task-123',
        },
        include: { user: expect.any(Object) },
        orderBy: { createdAt: 'desc' },
      });

      expect(result.entityType).toBe('TASK');
      expect(result.entityId).toBe('task-123');
      expect(result.history).toEqual(history);
    });
  });

  describe('findById', () => {
    it('should return log if found and user is ADMIN', async () => {
      const log = { id: 'l1', userId: 'user-xyz', metadata: {} };
      mockPrisma.auditLog.findUnique.mockResolvedValueOnce(log);

      const result = await service.findById('l1', 'admin-id', UserRole.ADMIN);
      expect(result).toEqual(log);
    });

    it('should throw NotFoundException if log not found', async () => {
      mockPrisma.auditLog.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.findById('non-existing', 'admin-id', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if non-admin tries to view another user unlinked log', async () => {
      const log = { id: 'l1', userId: 'user-xyz', metadata: {} };
      mockPrisma.auditLog.findUnique.mockResolvedValueOnce(log);

      await expect(
        service.findById('l1', 'user-abc', UserRole.DEVELOPER),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
