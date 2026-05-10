import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Redis from 'ioredis-mock'
import { FixedWindowStrategy } from '../../src/strategies'
import { RateLimitStorage } from '../../src/storage'

describe('FixedWindowStrategy', () => {
  let mockRedis: Redis
  let storage: RateLimitStorage
  let strategy: FixedWindowStrategy

  beforeEach(() => {
    mockRedis = new Redis()
    storage = new RateLimitStorage(
      {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:fw:',
      },
      mockRedis as any
    )
    strategy = new FixedWindowStrategy(
      {
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 5,
      },
      storage
    )
  })

  afterEach(async () => {
    await mockRedis.flushall()
  })

  it('should allow requests within limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await strategy.check('test-key')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5 - i - 1)
      expect(result.limit).toBe(5)
    }
  })

  it('should block requests at exactly maxRequests + 1', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await strategy.check('test-key')
      expect(result.allowed).toBe(true)
    }
    const result = await strategy.check('test-key')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.limit).toBe(5)
  })

  it('should block all requests after exceeding limit', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await strategy.check('test-key')
      if (i < 5) {
        expect(result.allowed).toBe(true)
      } else {
        expect(result.allowed).toBe(false)
      }
    }
  })

  it('should reset after window expires', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.check('test-key')
    }

    const result1 = await strategy.check('test-key')
    expect(result1.allowed).toBe(false)

    await mockRedis.flushall()

    const result2 = await strategy.check('test-key')
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(4)
  })

  it('should reset key explicitly', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.check('test-key')
    }

    const result1 = await strategy.check('test-key')
    expect(result1.allowed).toBe(false)

    await strategy.reset('test-key')

    const result2 = await strategy.check('test-key')
    expect(result2.allowed).toBe(true)
  })

  it('should handle concurrent requests without race conditions', async () => {
    const promises: Promise<any>[] = []

    for (let i = 0; i < 20; i++) {
      promises.push(strategy.check('concurrent-key'))
    }

    const results = await Promise.all(promises)

    const allowed = results.filter((r) => r.allowed).length
    const blocked = results.filter((r) => !r.allowed).length

    expect(allowed).toBeLessThanOrEqual(5)
    expect(blocked).toBeGreaterThanOrEqual(15)
  })

  it('should track different keys independently', async () => {
    for (let i = 0; i < 5; i++) {
      await strategy.check('key-1')
    }

    const result1 = await strategy.check('key-1')
    expect(result1.allowed).toBe(false)

    const result2 = await strategy.check('key-2')
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(4)
  })

  it('should return correct reset timestamp', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await strategy.check('test-key')
    expect(result.resetAt).toBeGreaterThanOrEqual(now + 59)
    expect(result.resetAt).toBeLessThanOrEqual(now + 60)
  })
})
