import type { Strategy, RateLimitResult } from './strategy';
import type Redis from 'ioredis';

export interface TokenBucketOptions {
  capacity: number;
  refillRate: number;
  prefix?: string;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketStrategy implements Strategy {
  private redis: Redis;
  private capacity: number;
  private refillRate: number;
  private prefix: string;

  constructor(redis: Redis, options: TokenBucketOptions) {
    this.redis = redis;
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.prefix = options.prefix ?? 'rl:tb';
  }

  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private refill(state: BucketState): BucketState {
    const now = Date.now();
    const elapsed = now - state.lastRefill;
    const refill = (elapsed / 1000) * this.refillRate;
    const tokens = Math.min(this.capacity, state.tokens + refill);
    return { tokens, lastRefill: now };
  }

  async consume(key: string): Promise<RateLimitResult> {
    const redisKey = this.getKey(key);
    const data = await this.redis.get(redisKey);

    let state: BucketState;
    if (data) {
      state = JSON.parse(data);
    } else {
      state = { tokens: this.capacity, lastRefill: Date.now() };
    }

    state = this.refill(state);

    if (state.tokens >= 1) {
      state.tokens -= 1;
      await this.redis.set(
        redisKey,
        JSON.stringify(state),
        'PX',
        Math.ceil((this.capacity / this.refillRate) * 1000) + 1000,
      );
      return {
        allowed: true,
        remaining: Math.floor(state.tokens),
        retryAfterMs: 0,
      };
    }

    const deficit = 1 - state.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRate) * 1000);

    await this.redis.set(
      redisKey,
      JSON.stringify(state),
      'PX',
      Math.ceil((this.capacity / this.refillRate) * 1000) + 1000,
    );

    return { allowed: false, remaining: 0, retryAfterMs };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.getKey(key));
  }
}
