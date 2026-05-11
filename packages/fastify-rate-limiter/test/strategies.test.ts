import Redis from 'ioredis-mock';
import { FixedWindowStrategy, TokenBucketStrategy } from '../src/strategies';
import type { RateLimitOptions } from '../src/types';

type RedisMock = InstanceType<typeof Redis>;

describe('Rate Limit Strategies', () => {
  let redis: RedisMock;
  let baseOptions: RateLimitOptions;

  beforeEach(() => {
    redis = new Redis() as any;
    baseOptions = {
      redis: redis as any,
      algorithm: 'fixed-window',
      keyExtractor: { type: 'ip' },
      windowSeconds: 60,
      maxRequests: 5,
      capacity: 5,
      refillRate: 1,
      keyPrefix: 'test',
    };
  });

  afterEach(async () => {
    await redis.flushall();
  });

  describe('FixedWindowStrategy', () => {
    let strategy: FixedWindowStrategy;

    beforeEach(() => {
      strategy = new FixedWindowStrategy();
    });

    it('should allow requests within limit', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await strategy.check('test-key', baseOptions);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5 - i - 1);
      }
    });

    it('should block requests when limit is reached', async () => {
      for (let i = 0; i < 5; i++) {
        await strategy.check('test-key', baseOptions);
      }
      
      const result = await strategy.check('test-key', baseOptions);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset count after window expires', async () => {
      const shortWindowOptions = { ...baseOptions, windowSeconds: 1 };
      
      for (let i = 0; i < 5; i++) {
        await strategy.check('test-key', shortWindowOptions);
      }
      
      const beforeResult = await strategy.check('test-key', shortWindowOptions);
      expect(beforeResult.allowed).toBe(false);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const afterResult = await strategy.check('test-key', shortWindowOptions);
      expect(afterResult.allowed).toBe(true);
      expect(afterResult.remaining).toBe(4);
    });

    it('should handle different keys independently', async () => {
      for (let i = 0; i < 5; i++) {
        await strategy.check('key1', baseOptions);
      }
      
      const key1Result = await strategy.check('key1', baseOptions);
      expect(key1Result.allowed).toBe(false);
      
      const key2Result = await strategy.check('key2', baseOptions);
      expect(key2Result.allowed).toBe(true);
    });

    it('should handle concurrent requests correctly', async () => {
      const promises = Array.from({ length: 10 }, () => 
        strategy.check('concurrent-key', baseOptions)
      );
      
      const results = await Promise.all(promises);
      const allowedCount = results.filter(r => r.allowed).length;
      
      expect(allowedCount).toBe(5);
    });
  });

  describe('TokenBucketStrategy', () => {
    let strategy: TokenBucketStrategy;

    beforeEach(() => {
      strategy = new TokenBucketStrategy();
    });

    it('should allow requests with available tokens', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await strategy.check('test-key', baseOptions);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5 - i - 1);
      }
    });

    it('should block when bucket is empty', async () => {
      for (let i = 0; i < 5; i++) {
        await strategy.check('test-key', baseOptions);
      }
      
      const result = await strategy.check('test-key', baseOptions);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should refill tokens over time', async () => {
      const fastRefillOptions = { ...baseOptions, capacity: 2, refillRate: 2 };
      
      for (let i = 0; i < 2; i++) {
        await strategy.check('test-key', fastRefillOptions);
      }
      
      const emptyResult = await strategy.check('test-key', fastRefillOptions);
      expect(emptyResult.allowed).toBe(false);
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const refilledResult = await strategy.check('test-key', fastRefillOptions);
      expect(refilledResult.allowed).toBe(true);
    });

    it('should not exceed bucket capacity', async () => {
      const options = { ...baseOptions, capacity: 3, refillRate: 10 };
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      for (let i = 0; i < 3; i++) {
        const result = await strategy.check('test-key', options);
        expect(result.allowed).toBe(true);
      }
      
      const result = await strategy.check('test-key', options);
      expect(result.allowed).toBe(false);
    });

    it('should handle concurrent requests correctly', async () => {
      const options = { ...baseOptions, capacity: 5 };
      const promises = Array.from({ length: 10 }, () => 
        strategy.check('concurrent-key', options)
      );
      
      const results = await Promise.all(promises);
      const allowedCount = results.filter(r => r.allowed).length;
      
      expect(allowedCount).toBe(5);
    });
  });
});
