import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import Redis from 'ioredis-mock';
import { createRateLimiter } from '../index';

function buildApp(options: Parameters<typeof createRateLimiter>[0] = {}) {
  const redis = new Redis() as any;
  const app = Fastify();
  const plugin = createRateLimiter({
    redis,
    windowMs: 1000,
    maxRequests: 5,
    ...options,
  });
  app.register(plugin);
  app.get('/test', async () => ({ ok: true }));
  return { app, redis };
}

describe('createRateLimiter plugin', () => {
  it('allows requests under limit', async () => {
    const { app, redis } = buildApp();
    await redis.flushall();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });

  it('returns 429 when over limit', async () => {
    const { app, redis } = buildApp();
    await redis.flushall();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'GET', url: '/test' });
    }
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('sets X-RateLimit-Remaining header', async () => {
    const { app, redis } = buildApp();
    await redis.flushall();
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
    await app.close();
  });

  it('whitelist bypasses rate limiting', async () => {
    const { app, redis } = buildApp({
      whitelist: ['127.0.0.1'],
    });
    await redis.flushall();
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });

  it('blacklist always rejects', async () => {
    const { app, redis } = buildApp({
      blacklist: ['127.0.0.1'],
    });
    await redis.flushall();
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it('custom keyGenerator using header', async () => {
    const redis = new Redis() as any;
    await redis.flushall();
    const app = Fastify();
    const plugin = createRateLimiter({
      redis,
      maxRequests: 2,
      keyGenerator: (req) => req.headers['x-user-id'] as string || req.ip,
    });
    app.register(plugin);
    app.get('/test', async () => ({ ok: true }));

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-user-id': 'userA' },
      });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'userA' },
    });
    expect(blocked.statusCode).toBe(429);

    const otherUser = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'userB' },
    });
    expect(otherUser.statusCode).toBe(200);

    await app.close();
  });

  it('custom onExceeded handler', async () => {
    const redis = new Redis() as any;
    await redis.flushall();
    const app = Fastify();
    const plugin = createRateLimiter({
      redis,
      maxRequests: 1,
      onExceeded: async (req, reply, retryAfterMs) => {
        reply.code(503);
        reply.send({ custom: true, retryAfterMs });
      },
    });
    app.register(plugin);
    app.get('/test', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/test' });
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.custom).toBe(true);
    await app.close();
  });

  it('token-bucket algorithm works', async () => {
    const redis = new Redis() as any;
    await redis.flushall();
    const app = Fastify();
    const plugin = createRateLimiter({
      redis,
      algorithm: 'token-bucket',
      capacity: 3,
      refillRate: 1,
    });
    app.register(plugin);
    app.get('/test', async () => ({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({ method: 'GET', url: '/test' });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it('throws if neither redis nor strategy is provided', () => {
    expect(() => {
      const plugin = createRateLimiter({});
      Fastify().register(plugin);
    }).not.toThrow();

    expect(async () => {
      const plugin = createRateLimiter({});
      const app = Fastify();
      app.register(plugin);
      await app.ready();
    }).rejects.toThrow();
  });

  it('registering multiple limiter plugins does not throw duplicate decorator error', async () => {
    const redis = new Redis() as any;
    await redis.flushall();
    const app = Fastify();

    const limiter1 = createRateLimiter({
      redis,
      algorithm: 'fixed-window',
      windowMs: 1000,
      maxRequests: 5,
      prefix: 'rl:multi:1',
    });
    const limiter2 = createRateLimiter({
      redis,
      algorithm: 'token-bucket',
      capacity: 3,
      refillRate: 1,
      prefix: 'rl:multi:2',
    });

    app.register(limiter1);
    app.register(async (instance) => {
      instance.register(limiter2);
      instance.get('/burst', async () => ({ ok: true }));
    }, { prefix: '/api' });

    app.get('/', async () => ({ ok: true }));

    await app.ready();

    const res1 = await app.inject({ method: 'GET', url: '/' });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'GET', url: '/api/burst' });
    expect(res2.statusCode).toBe(200);

    await app.close();
  });
});
