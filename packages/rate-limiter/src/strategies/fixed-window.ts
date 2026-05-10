import type { Strategy, RateLimitResult } from './strategy';
import type Redis from 'ioredis';

export interface FixedWindowOptions {
  windowMs: number;
  maxRequests: number;
  prefix?: string;
}

export class FixedWindowStrategy implements Strategy {
  private redis: Redis;
  private windowMs: number;
  private maxRequests: number;
  private prefix: string;

  constructor(redis: Redis, options: FixedWindowOptions) {
    this.redis = redis;
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.prefix = options.prefix ?? 'rl:fw';
  }

  private getKey(key: string, window: number): string {
    return `${this.prefix}:${key}:${window}`;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const window = Math.floor(Date.now() / this.windowMs);
    const redisKey = this.getKey(key, window);

    const current = await this.redis.incr(redisKey);

    if (current === 1) {
      await this.redis.pexpire(redisKey, this.windowMs * 2);
    }

    if (current > this.maxRequests) {
      const ttl = await this.redis.pttl(redisKey);
      const retryAfterMs = ttl > 0 ? ttl : this.windowMs;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    const remaining = this.maxRequests - current;
    const ttl = await this.redis.pttl(redisKey);
    const retryAfterMs = ttl > 0 ? ttl : this.windowMs;
    return { allowed: true, remaining, retryAfterMs };
  }

  async reset(key: string): Promise<void> {
    const window = Math.floor(Date.now() / this.windowMs);
    await this.redis.del(this.getKey(key, window));
  }
}
