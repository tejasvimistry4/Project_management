import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../redis/redis.service';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    const userId = request.user?.id || request.user?.sub;
    const rawIp =
      request.headers?.['x-forwarded-for'] ||
      request.headers?.['x-real-ip'] ||
      request.socket?.remoteAddress ||
      request.ip ||
      '127.0.0.1';
    const clientIp =
      typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : String(rawIp);

    const identifier = userId ? `user:${userId}` : `ip:${clientIp}`;
    const prefix =
      options.keyPrefix ||
      `${request.method}:${request.route?.path || request.path}`;
    const rateLimitKey = `rl:${prefix}:${identifier}`;

    try {
      if (!this.redisService.isHealthy()) {
        this.logger.debug(
          `Redis offline; allowing request through without rate limiting for ${rateLimitKey}`,
        );
        return true;
      }

      const { count, ttl } = await this.redisService.incrWithTtl(
        rateLimitKey,
        options.duration,
      );

      if (response && typeof response.setHeader === 'function') {
        response.setHeader('X-RateLimit-Limit', options.points);
        response.setHeader(
          'X-RateLimit-Remaining',
          Math.max(0, options.points - count),
        );
        response.setHeader(
          'X-RateLimit-Reset',
          ttl > 0 ? ttl : options.duration,
        );
      }

      if (count > options.points) {
        if (response && typeof response.setHeader === 'function') {
          response.setHeader('Retry-After', ttl > 0 ? ttl : options.duration);
        }

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests, please try again later.',
            retryAfter: ttl > 0 ? ttl : options.duration,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err;
      }

      this.logger.warn(
        `Rate limiting check failed unexpectedly for ${rateLimitKey}: ${err.message}. Allowing request.`,
      );
      return true;
    }
  }
}
