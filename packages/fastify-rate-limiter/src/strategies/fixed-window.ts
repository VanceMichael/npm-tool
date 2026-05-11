import type { RateLimitStrategy, RateLimitResult, RateLimitOptions } from '../types';

export class FixedWindowStrategy implements RateLimitStrategy {
  async check(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const { redis, windowSeconds, maxRequests, keyPrefix = 'rate-limit' } = options;
    const redisKey = `${keyPrefix}:fw:${key}`;
    
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const windowKey = `${redisKey}:${windowStart}`;
    
    const result = await redis
      .multi()
      .incr(windowKey)
      .expire(windowKey, windowSeconds)
      .exec();
    
    const count = result?.[0]?.[1] as number;
    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetTime = (windowStart + windowSeconds) * 1000;
    
    return {
      allowed,
      limit: maxRequests,
      remaining,
      resetTime,
    };
  }
}
