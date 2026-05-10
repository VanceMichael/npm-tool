import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import Redis from 'ioredis-mock'
import { createRateLimiter } from '../src'

describe('createRateLimiter plugin', () => {
  let fastify: ReturnType<typeof Fastify>
  let mockRedis: Redis

  beforeEach(() => {
    fastify = Fastify()
    mockRedis = new Redis()
  })

  afterEach(async () => {
    await mockRedis.flushall()
    await fastify.close()
  })

  it('should register as fastify plugin', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 3,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:plugin:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    await fastify.ready()
    expect(fastify.printRoutes()).toBeTruthy()
    await limiter.close()
  })

  it('should allow requests within limit', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 3,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:plugin:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 3; i++) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-forwarded-for': '192.168.1.1' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['x-ratelimit-limit']).toBe('3')
    }

    await limiter.close()
  })

  it('should return 429 when exceeding limit', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 3,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:plugin:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-forwarded-for': '192.168.1.1' },
      })
    }

    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBeTruthy()

    await limiter.close()
  })

  it('should track different routes independently', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 3,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:plugin:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/route1', async () => ({ ok: true }))
    fastify.get('/route2', async () => ({ ok: true }))

    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'GET',
        url: '/route1',
        headers: { 'x-forwarded-for': '192.168.1.1' },
      })
    }

    const response1 = await fastify.inject({
      method: 'GET',
      url: '/route1',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(response1.statusCode).toBe(429)

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/route2',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(response2.statusCode).toBe(200)

    await limiter.close()
  })

  it('should track different IPs independently', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 3,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:plugin2:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: '192.168.1.1',
      })
    }

    const response1 = await fastify.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '192.168.1.1',
    })
    expect(response1.statusCode).toBe(429)

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '192.168.1.2',
    })
    expect(response2.statusCode).toBe(200)

    await limiter.close()
  })

  it('should support header-based rate limiting', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 2,
      dimension: 'header',
      headerName: 'X-User-Id',
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:header:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-user-id': 'user-123' },
      })
    }

    const response1 = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'user-123' },
    })
    expect(response1.statusCode).toBe(429)

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'user-456' },
    })
    expect(response2.statusCode).toBe(200)

    await limiter.close()
  })

  it('should support custom key generator', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 2,
      dimension: 'custom',
      keyGenerator: (req) => `custom:${req.headers['x-api-key'] || 'anon'}`,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:custom:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-api-key': 'key-1' },
      })
    }

    const response1 = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'key-1' },
    })
    expect(response1.statusCode).toBe(429)

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'key-2' },
    })
    expect(response2.statusCode).toBe(200)

    await limiter.close()
  })

  it('should whitelist keys', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 1,
      dimension: 'header',
      headerName: 'X-User-Id',
      whitelist: ['trusted-user'],
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:whitelist:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 10; i++) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-user-id': 'trusted-user' },
      })
      expect(response.statusCode).toBe(200)
    }

    await limiter.close()
  })

  it('should blacklist keys', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 100,
      dimension: 'header',
      headerName: 'X-User-Id',
      blacklist: ['blocked-user'],
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:blacklist:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'blocked-user' },
    })
    expect(response.statusCode).toBe(403)

    await limiter.close()
  })

  it('should support custom handler', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      windowSeconds: 60,
      maxRequests: 1,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:handler:',
      },
      _testRedisClient: mockRedis,
      handler: (req, reply) => {
        reply.code(429).send({ error: 'RATE_LIMITED', custom: true })
      },
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })

    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(response.statusCode).toBe(429)
    const body = JSON.parse(response.payload)
    expect(body.error).toBe('RATE_LIMITED')
    expect(body.custom).toBe(true)

    await limiter.close()
  })

  it('should work with token-bucket algorithm', async () => {
    const limiter = createRateLimiter({
      algorithm: 'token-bucket',
      capacity: 5,
      refillRate: 1,
      refillIntervalSeconds: 1,
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:tb:',
      },
      _testRedisClient: mockRedis,
    } as any)

    fastify.register(limiter)
    fastify.get('/test', async () => ({ ok: true }))

    for (let i = 0; i < 5; i++) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
      expect(response.statusCode).toBe(200)
    }

    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(response.statusCode).toBe(429)

    await limiter.close()
  })
})
