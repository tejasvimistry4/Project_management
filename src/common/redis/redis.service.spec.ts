import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      status: 'ready',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockReturnValue(undefined),
      on: jest.fn((event: string, callback: (...args: any[]) => void) => {
        if (event === 'ready') {
          callback();
        }
        return mockRedisClient;
      }),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      scan: jest.fn().mockResolvedValue(['0', []]),
      eval: jest.fn().mockResolvedValue([1, 60]),
      flushall: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    (service as any).client = mockRedisClient;
    (service as any).isConnected = true;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isHealthy()).toBe(true);
  });

  describe('get and set', () => {
    it('should serialize and set a value in Redis with TTL', async () => {
      const result = await service.set('test-key', { foo: 'bar' }, 300);

      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        JSON.stringify({ foo: 'bar' }),
        'EX',
        300,
      );
    });

    it('should retrieve and deserialize a value from Redis', async () => {
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ count: 42 }));

      const data = await service.get<{ count: number }>('test-key');
      expect(data).toEqual({ count: 42 });
      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);

      const data = await service.get('missing-key');
      expect(data).toBeNull();
    });
  });

  describe('getOrSet (Cache-Aside)', () => {
    it('should return cached value if present without calling fetchFn', async () => {
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ from: 'cache' }),
      );
      const fetchFn = jest.fn();

      const result = await service.getOrSet('test-key', fetchFn, 300);

      expect(result).toEqual({ from: 'cache' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should call fetchFn and cache result on cache miss', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      const fetchFn = jest.fn().mockResolvedValue({ from: 'postgres' });

      const result = await service.getOrSet('test-key', fetchFn, 300);

      expect(result).toEqual({ from: 'postgres' });
      expect(fetchFn).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        JSON.stringify({ from: 'postgres' }),
        'EX',
        300,
      );
    });
  });

  describe('del and delByPattern', () => {
    it('should delete specified key', async () => {
      const count = await service.del('test-key');
      expect(count).toBe(1);
      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
    });

    it('should scan and delete matching keys by pattern without blocking', async () => {
      mockRedisClient.scan
        .mockResolvedValueOnce([
          '12',
          ['cache:dashboard:1', 'cache:dashboard:2'],
        ])
        .mockResolvedValueOnce(['0', ['cache:dashboard:3']]);
      mockRedisClient.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const total = await service.delByPattern('cache:dashboard:*');

      expect(total).toBe(3);
      expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
    });
  });

  describe('incrWithTtl (Rate Limiting)', () => {
    it('should execute atomic Lua script and return count and ttl', async () => {
      mockRedisClient.eval.mockResolvedValueOnce([2, 59]);

      const result = await service.incrWithTtl('rl:login:ip:127.0.0.1', 60);

      expect(result).toEqual({ count: 2, ttl: 59 });
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'rl:login:ip:127.0.0.1',
        60,
      );
    });
  });

  describe('Graceful Fallback on Redis Failures', () => {
    beforeEach(() => {
      (service as any).client = null;
      (service as any).isConnected = false;
    });

    it('should return isHealthy = false when client is null', () => {
      expect(service.isHealthy()).toBe(false);
    });

    it('should return null on get when Redis is offline', async () => {
      const data = await service.get('any-key');
      expect(data).toBeNull();
    });

    it('should return false on set when Redis is offline', async () => {
      const result = await service.set('any-key', { val: 1 });
      expect(result).toBe(false);
    });

    it('should fallback directly to fetchFn in getOrSet without throwing', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ fallback: true });

      const result = await service.getOrSet('any-key', fetchFn, 300);

      expect(result).toEqual({ fallback: true });
      expect(fetchFn).toHaveBeenCalled();
    });

    it('should return fallback { count: 1, ttl: 60 } on incrWithTtl when offline', async () => {
      const result = await service.incrWithTtl('rl:any', 60);
      expect(result).toEqual({ count: 1, ttl: 60 });
    });
  });
});
