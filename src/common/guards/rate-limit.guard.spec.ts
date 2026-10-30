import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../redis/redis.service';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let redisService: RedisService;

  const mockResponse = () => {
    const headers: Record<string, any> = {};
    return {
      headers,
      setHeader: jest.fn((k: string, v: any) => {
        headers[k] = v;
      }),
    };
  };

  const createMockContext = (req: any, res: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            isHealthy: jest.fn().mockReturnValue(true),
            incrWithTtl: jest.fn().mockResolvedValue({ count: 1, ttl: 60 }),
          },
        },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
    reflector = module.get<Reflector>(Reflector);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow request if no @RateLimit metadata is found', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const res = mockResponse();
    const ctx = createMockContext({}, res);

    const canActivate = await guard.canActivate(ctx);
    expect(canActivate).toBe(true);
    expect(redisService.incrWithTtl).not.toHaveBeenCalled();
  });

  it('should allow request and set rate limit headers when below limit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      points: 5,
      duration: 60,
      keyPrefix: 'auth:login',
    });
    jest
      .spyOn(redisService, 'incrWithTtl')
      .mockResolvedValue({ count: 2, ttl: 55 });

    const req = {
      ip: '192.168.1.1',
      headers: {},
      method: 'POST',
      path: '/auth/login',
    };
    const res = mockResponse();
    const ctx = createMockContext(req, res);

    const canActivate = await guard.canActivate(ctx);

    expect(canActivate).toBe(true);
    expect(redisService.incrWithTtl).toHaveBeenCalledWith(
      'rl:auth:login:ip:192.168.1.1',
      60,
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 3);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 55);
  });

  it('should use userId when user is authenticated', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      points: 10,
      duration: 60,
      keyPrefix: 'reports',
    });
    jest
      .spyOn(redisService, 'incrWithTtl')
      .mockResolvedValue({ count: 1, ttl: 60 });

    const req = {
      user: { id: 'usr-123' },
      headers: {},
      method: 'GET',
      path: '/analytics/projects/proj-1/dashboard',
    };
    const res = mockResponse();
    const ctx = createMockContext(req, res);

    const canActivate = await guard.canActivate(ctx);

    expect(canActivate).toBe(true);
    expect(redisService.incrWithTtl).toHaveBeenCalledWith(
      'rl:reports:user:usr-123',
      60,
    );
  });

  it('should throw 429 HttpException when rate limit is exceeded', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      points: 5,
      duration: 60,
      keyPrefix: 'auth:login',
    });
    jest
      .spyOn(redisService, 'incrWithTtl')
      .mockResolvedValue({ count: 6, ttl: 45 });

    const req = {
      ip: '10.0.0.1',
      headers: {},
      method: 'POST',
      path: '/auth/login',
    };
    const res = mockResponse();
    const ctx = createMockContext(req, res);

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 45);
    try {
      await guard.canActivate(ctx);
    } catch (error: any) {
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.getResponse()).toEqual({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests, please try again later.',
        retryAfter: 45,
      });
    }
  });

  it('should fail-open gracefully when Redis is offline / unhealthy', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      points: 5,
      duration: 60,
      keyPrefix: 'auth:login',
    });
    jest.spyOn(redisService, 'isHealthy').mockReturnValue(false);

    const req = {
      ip: '127.0.0.1',
      headers: {},
      method: 'POST',
      path: '/auth/login',
    };
    const res = mockResponse();
    const ctx = createMockContext(req, res);

    const canActivate = await guard.canActivate(ctx);

    expect(canActivate).toBe(true);
    expect(redisService.incrWithTtl).not.toHaveBeenCalled();
  });

  it('should fail-open gracefully when Redis throws an unexpected runtime error', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      points: 5,
      duration: 60,
      keyPrefix: 'auth:login',
    });
    jest.spyOn(redisService, 'isHealthy').mockReturnValue(true);
    jest
      .spyOn(redisService, 'incrWithTtl')
      .mockRejectedValue(new Error('Redis connection timeout'));

    const req = {
      ip: '127.0.0.1',
      headers: {},
      method: 'POST',
      path: '/auth/login',
    };
    const res = mockResponse();
    const ctx = createMockContext(req, res);

    const canActivate = await guard.canActivate(ctx);

    expect(canActivate).toBe(true);
  });
});
