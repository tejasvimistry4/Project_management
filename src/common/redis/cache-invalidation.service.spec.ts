import { Test, TestingModule } from '@nestjs/testing';
import { CacheInvalidationService } from './cache-invalidation.service';
import { RedisService } from './redis.service';

describe('CacheInvalidationService', () => {
  let service: CacheInvalidationService;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheInvalidationService,
        {
          provide: RedisService,
          useValue: {
            delByPattern: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<CacheInvalidationService>(CacheInvalidationService);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('invalidateProject', () => {
    it('should delete project dashboard, workload, time-summary and org workload keys', async () => {
      await service.invalidateProject('proj-123');

      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:dashboard:proj-123*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:workload:proj-123*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:time-summary:project:proj-123*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:workload:org:*',
      );
    });

    it('should do nothing if projectId is empty', async () => {
      await service.invalidateProject('');
      expect(redisService.delByPattern).not.toHaveBeenCalled();
    });
  });

  describe('invalidateTask & invalidateIssue', () => {
    it('should call invalidateProject when task changes', async () => {
      const spy = jest.spyOn(service, 'invalidateProject');
      await service.invalidateTask('proj-abc');
      expect(spy).toHaveBeenCalledWith('proj-abc');
    });

    it('should call invalidateProject when issue changes', async () => {
      const spy = jest.spyOn(service, 'invalidateProject');
      await service.invalidateIssue('proj-xyz');
      expect(spy).toHaveBeenCalledWith('proj-xyz');
    });
  });

  describe('invalidateMilestone', () => {
    it('should invalidate dashboard keys for the project', async () => {
      await service.invalidateMilestone('proj-ms-1');
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:dashboard:proj-ms-1*',
      );
    });
  });

  describe('invalidateTimeTracking', () => {
    it('should invalidate workload, project dashboard, and project time summary when projectId is provided', async () => {
      await service.invalidateTimeTracking('proj-tt-1', undefined);

      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:workload:*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:dashboard:proj-tt-1*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:time-summary:project:proj-tt-1*',
      );
    });

    it('should invalidate user time summary when userId is provided', async () => {
      await service.invalidateTimeTracking(undefined, 'user-tt-1');

      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:workload:*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:time-summary:user:user-tt-1*',
      );
    });

    it('should invalidate both project and user keys when both are provided', async () => {
      await service.invalidateTimeTracking('proj-tt-1', 'user-tt-1');

      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:workload:*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:dashboard:proj-tt-1*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:time-summary:project:proj-tt-1*',
      );
      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:time-summary:user:user-tt-1*',
      );
    });
  });

  describe('invalidateAll', () => {
    it('should invalidate all cache keys with pattern cache:*', async () => {
      await service.invalidateAll();
      expect(redisService.delByPattern).toHaveBeenCalledWith('cache:*');
    });
  });

  describe('Error resilience', () => {
    it('should not throw if Redis delByPattern fails', async () => {
      jest
        .spyOn(redisService, 'delByPattern')
        .mockRejectedValue(new Error('Connection reset'));

      await expect(
        service.invalidateProject('proj-fail'),
      ).resolves.not.toThrow();
      await expect(
        service.invalidateMilestone('proj-fail'),
      ).resolves.not.toThrow();
      await expect(
        service.invalidateTimeTracking('p', 'u'),
      ).resolves.not.toThrow();
      await expect(service.invalidateAll()).resolves.not.toThrow();
    });
  });
});
