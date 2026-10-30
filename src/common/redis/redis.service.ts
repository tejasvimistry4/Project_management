import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);
  private isConnected = false;

  private readonly rateLimitLuaScript = `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        local ttl = redis.call('TTL', KEYS[1])
        return {current, ttl}
    `;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeClient();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private async initializeClient(): Promise<void> {
    const redisUrl =
      this.configService.get<string>('redis.url') ||
      process.env.REDIS_URL ||
      'redis://localhost:6379';

    const redisOptions: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy: (times) => {
        if (times > 5) {
          this.logger.warn(
            `Redis connection failed after ${times} attempts. Halting auto-reconnect retries.`,
          );
          return null;
        }
        const delay = Math.min(times * 1000, 3000);
        this.logger.debug(
          `Reconnecting to Redis in ${delay}ms (attempt #${times})...`,
        );
        return delay;
      },
    };

    try {
      this.client = new Redis(redisUrl, redisOptions);

      this.client.on('connect', () => {
        this.logger.log('Redis TCP connection established');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        this.logger.log('Redis client is ready and accepting commands');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection warning: ${err.message}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.logger.debug('Redis connection closed');
      });

      await this.client.connect().catch((err) => {
        this.isConnected = false;
        this.logger.warn(
          `Initial Redis connection could not be established (${err.message}). Application will run in graceful fallback mode using PostgreSQL.`,
        );
      });
    } catch (err: any) {
      this.isConnected = false;
      this.logger.warn(
        `Failed to initialize Redis client: ${err.message}. Graceful fallback active.`,
      );
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isHealthy(): boolean {
    return (
      this.isConnected && this.client !== null && this.client.status === 'ready'
    );
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isHealthy() || !this.client) {
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err: any) {
      this.logger.warn(`Redis GET error for key "${key}": ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!this.isHealthy() || !this.client) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (err: any) {
      this.logger.warn(`Redis SET error for key "${key}": ${err.message}`);
      return false;
    }
  }

  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = await fetchFn();

    if (fresh !== null && fresh !== undefined) {
      void this.set(key, fresh, ttlSeconds);
    }

    return fresh;
  }

  async del(keyOrKeys: string | string[]): Promise<number> {
    if (!this.isHealthy() || !this.client) {
      return 0;
    }

    try {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      if (keys.length === 0) return 0;
      return await this.client.del(...keys);
    } catch (err: any) {
      this.logger.warn(`Redis DEL error: ${err.message}`);
      return 0;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.isHealthy() || !this.client) {
      return 0;
    }

    let totalDeleted = 0;
    let cursor = '0';

    try {
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          const deleted = await this.client.del(...keys);
          totalDeleted += deleted;
        }
      } while (cursor !== '0');

      return totalDeleted;
    } catch (err: any) {
      this.logger.warn(
        `Redis delByPattern error for pattern "${pattern}": ${err.message}`,
      );
      return totalDeleted;
    }
  }

  async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    if (!this.isHealthy() || !this.client) {
      return { count: 1, ttl: ttlSeconds };
    }

    try {
      const result = (await this.client.eval(
        this.rateLimitLuaScript,
        1,
        key,
        ttlSeconds,
      )) as [number, number];

      return {
        count: Number(result[0]),
        ttl: Number(result[1]),
      };
    } catch (err: any) {
      this.logger.warn(
        `Redis incrWithTtl error for key "${key}": ${err.message}`,
      );
      return { count: 1, ttl: ttlSeconds };
    }
  }

  async flushAll(): Promise<void> {
    if (!this.isHealthy() || !this.client) {
      return;
    }
    try {
      await this.client.flushall();
    } catch (err: any) {
      this.logger.warn(`Redis flushAll error: ${err.message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {}
      this.isConnected = false;
      this.client = null;
    }
  }
}
