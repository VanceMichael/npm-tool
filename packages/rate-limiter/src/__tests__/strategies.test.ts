import { describe, it, expect, beforeEach } from 'vitest';
import Redis from 'ioredis-mock';
import { FixedWindowStrategy } from '../strategies/fixed-window';
import { TokenBucketStrategy } from '../strategies/token-bucket';

function createRedis(): any {
  const r = new Redis() as any;
  return r;
}

describe('FixedWindowStrategy', () => {
  let redis: any;
  let strategy: FixedWindowStrategy;

  beforeEach(async () => {
    redis = createRedis();
    await redis.flushall();
    strategy = new FixedWindowStrategy(redis, {
      windowMs: 1000,
      maxRequests: 5,
      prefix: 'test:fw',
    });
  });

  it('allows requests within the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await strategy.consume('user1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it('rejects requests exceeding the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const result = await strategy.consume('user1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('exactly at threshold: the N-th request is allowed, (N+1)-th is rejected', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await strategy.consume('user1');
      expect(result.allowed).toBe(true);
    }

    const overThreshold = await strategy.consume('user1');
    expect(overThreshold.allowed).toBe(false);
    expect(overThreshold.remaining).toBe(0);
  });

  it('different keys are independent', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }

    const user1Result = await strategy.consume('user1');
    expect(user1Result.allowed).toBe(false);

    const user2Result = await strategy.consume('user2');
    expect(user2Result.allowed).toBe(true);
    expect(user2Result.remaining).toBe(4);
  });

  it('resets a key correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const blocked = await strategy.consume('user1');
    expect(blocked.allowed).toBe(false);

    await strategy.reset('user1');

    const afterReset = await strategy.consume('user1');
    expect(afterReset.allowed).toBe(true);
  });

  it('retryAfterMs is positive when rejected', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const result = await strategy.consume('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('TokenBucketStrategy', () => {
  let redis: any;
  let strategy: TokenBucketStrategy;

  beforeEach(async () => {
    redis = createRedis();
    await redis.flushall();
    strategy = new TokenBucketStrategy(redis, {
      capacity: 5,
      refillRate: 1,
      prefix: 'test:tb',
    });
  });

  it('allows requests when bucket has tokens', async () => {
    const result = await strategy.consume('user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('rejects requests when bucket is empty', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const result = await strategy.consume('user1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('at exact capacity: the capacity-th request is allowed, one more is rejected', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await strategy.consume('user1');
      expect(r.allowed).toBe(true);
    }

    const lastAllowed = await strategy.consume('user1');
    expect(lastAllowed.allowed).toBe(true);
    expect(lastAllowed.remaining).toBe(0);

    const overCapacity = await strategy.consume('user1');
    expect(overCapacity.allowed).toBe(false);
  });

  it('retryAfterMs is reasonable when bucket is empty', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const result = await strategy.consume('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(1500);
  });

  it('different keys have independent buckets', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }

    const user1Result = await strategy.consume('user1');
    expect(user1Result.allowed).toBe(false);

    const user2Result = await strategy.consume('user2');
    expect(user2Result.allowed).toBe(true);
  });

  it('resets a key correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.consume('user1');
    }
    const blocked = await strategy.consume('user1');
    expect(blocked.allowed).toBe(false);

    await strategy.reset('user1');

    const afterReset = await strategy.consume('user1');
    expect(afterReset.allowed).toBe(true);
  });
});

describe('Concurrent scenarios', () => {
  it('fixed-window: concurrent requests all get counted', async () => {
    const redis = createRedis();
    await redis.flushall();
    const strategy = new FixedWindowStrategy(redis, {
      windowMs: 1000,
      maxRequests: 10,
      prefix: 'test:conc:fw',
    });

    const promises = Array.from({ length: 10 }, () => strategy.consume('user1'));
    const results = await Promise.all(promises);

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(10);

    const overLimit = await strategy.consume('user1');
    expect(overLimit.allowed).toBe(false);
  });

  it('token-bucket: sequential rapid requests drain the bucket', async () => {
    const redis = createRedis();
    await redis.flushall();
    const strategy = new TokenBucketStrategy(redis, {
      capacity: 10,
      refillRate: 1,
      prefix: 'test:conc:tb',
    });

    for (let i = 0; i < 10; i++) {
      const result = await strategy.consume('user1');
      expect(result.allowed).toBe(true);
    }

    const overLimit = await strategy.consume('user1');
    expect(overLimit.allowed).toBe(false);
  });
});
