import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Redis from 'ioredis-mock'
import { TokenBucketStrategy } from '../../src/strategies'
import { RateLimitStorage } from '../../src/storage'

describe('TokenBucketStrategy', () => {
  let mockRedis: Redis
  let storage: RateLimitStorage
  let strategy: TokenBucketStrategy

  beforeEach(() => {
    mockRedis = new Redis()
    storage = new RateLimitStorage(
      {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:tb:',
      },
      mockRedis as any
    )
    strategy = new TokenBucketStrategy(
      {
        algorithm: 'token-bucket',
        capacity: 10,
        refillRate: 1,
        refillIntervalSeconds: 1,
      },
      storage
    )
  })

  afterEach(async () => {
    await mockRedis.flushall()
  })

  it('should start with full capacity', async () => {
    const result = await strategy.check('test-key')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
    expect(result.limit).toBe(10)
  })

  it('should allow requests until bucket is empty', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await strategy.check('test-key')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(10 - i - 1)
    }
  })

  it('should block when bucket is empty', async () => {
    for (let i = 0; i < 10; i++) {
      await strategy.check('test-key')
    }

    const result = await strategy.check('test-key')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('should refill tokens over time', async () => {
    for (let i = 0; i < 10; i++) {
      await strategy.check('test-key')
    }

    let result = await strategy.check('test-key')
    expect(result.allowed).toBe(false)

    const currentState = await mockRedis.get('test:tb:test-key')
    const [tokens, lastRefill] = (currentState || '0:0').split(':').map(Number)

    const newRefillTime = lastRefill - 3
    await mockRedis.set('test:tb:test-key', `${tokens}:${newRefillTime}`)

    result = await strategy.check('test-key')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThanOrEqual(2)
  })

  it('should not exceed capacity when refilling', async () => {
    for (let i = 0; i < 10; i++) {
      await strategy.check('test-key')
    }

    const currentState = await mockRedis.get('test:tb:test-key')
    const [tokens, lastRefill] = (currentState || '0:0').split(':').map(Number)

    const newRefillTime = lastRefill - 100
    await mockRedis.set('test:tb:test-key', `${tokens}:${newRefillTime}`)

    const result = await strategy.check('test-key')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
  })

  it('should handle concurrent requests without race conditions', async () => {
    const promises: Promise<any>[] = []

    for (let i = 0; i < 30; i++) {
      promises.push(strategy.check('concurrent-key'))
    }

    const results = await Promise.all(promises)

    const allowed = results.filter((r) => r.allowed).length
    const blocked = results.filter((r) => !r.allowed).length

    expect(allowed).toBeLessThanOrEqual(10)
    expect(blocked).toBeGreaterThanOrEqual(20)
  })

  it('should track different keys independently', async () => {
    for (let i = 0; i < 10; i++) {
      await strategy.check('key-1')
    }

    const result1 = await strategy.check('key-1')
    expect(result1.allowed).toBe(false)

    const result2 = await strategy.check('key-2')
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(9)
  })

  it('should reset key explicitly', async () => {
    for (let i = 0; i < 10; i++) {
      await strategy.check('test-key')
    }

    const result1 = await strategy.check('test-key')
    expect(result1.allowed).toBe(false)

    await strategy.reset('test-key')

    const result2 = await strategy.check('test-key')
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(9)
  })
})
