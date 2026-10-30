import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly redisService: RedisService) {}

  async invalidateProject(projectId: string): Promise<void> {
    if (!projectId) return;

    try {
      await Promise.all([
        this.redisService.delByPattern(`cache:dashboard:${projectId}*`),
        this.redisService.delByPattern(`cache:workload:${projectId}*`),
        this.redisService.delByPattern(
          `cache:time-summary:project:${projectId}*`,
        ),
        this.redisService.delByPattern('cache:workload:org:*'),
      ]);
      this.logger.debug(`Invalidated cache for project: ${projectId}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to invalidate project cache (${projectId}): ${err.message}`,
      );
    }
  }

  async invalidateTask(projectId: string): Promise<void> {
    await this.invalidateProject(projectId);
  }

  async invalidateIssue(projectId: string): Promise<void> {
    await this.invalidateProject(projectId);
  }

  async invalidateMilestone(projectId: string): Promise<void> {
    if (!projectId) return;

    try {
      await this.redisService.delByPattern(`cache:dashboard:${projectId}*`);
      this.logger.debug(
        `Invalidated milestone cache for project: ${projectId}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to invalidate milestone cache (${projectId}): ${err.message}`,
      );
    }
  }

  async invalidateTimeTracking(
    projectId?: string,
    userId?: string,
  ): Promise<void> {
    try {
      const promises: Promise<any>[] = [
        this.redisService.delByPattern('cache:workload:*'),
      ];

      if (projectId) {
        promises.push(
          this.redisService.delByPattern(`cache:dashboard:${projectId}*`),
          this.redisService.delByPattern(
            `cache:time-summary:project:${projectId}*`,
          ),
        );
      }

      if (userId) {
        promises.push(
          this.redisService.delByPattern(`cache:time-summary:user:${userId}*`),
        );
      }

      await Promise.all(promises);
      this.logger.debug(
        `Invalidated time tracking cache for project: ${projectId}, user: ${userId}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to invalidate time tracking cache: ${err.message}`,
      );
    }
  }

  async invalidateAll(): Promise<void> {
    try {
      await this.redisService.delByPattern('cache:*');
      this.logger.log('Invalidated all application cache keys');
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate all caches: ${err.message}`);
    }
  }
}
