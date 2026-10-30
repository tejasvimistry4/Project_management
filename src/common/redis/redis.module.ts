import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { CacheInvalidationService } from './cache-invalidation.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, CacheInvalidationService, RateLimitGuard],
  exports: [RedisService, CacheInvalidationService, RateLimitGuard],
})
export class RedisModule {}
