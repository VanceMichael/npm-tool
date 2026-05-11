import Fastify, { FastifyInstance } from 'fastify';
import Redis from 'ioredis-mock';
import { createRateLimiter } from '../src';

type RedisMock = InstanceType<typeof Redis>;

describe('createRateLimiter Plugin', () => {
  let redis: RedisMock;
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    redis = new Redis() as any;
    fastify = Fastify();
  });

  afterEach(async () => {
    await redis.flushall();
    await fastify.close();
  });

  describe('Basic Functionality', () => {
    it('should allow requests within limit', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 3,
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      for (let i = 0; i < 3; i++) {
        const response = await fastify.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '127.0.0.1',
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('should return 429 when limit exceeded', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '127.0.0.1' });
      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '127.0.0.1' });
      
      const response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: '127.0.0.1' 
      });
      
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    });
  });

  describe('Key Extraction', () => {
    it('should rate limit by IP', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
        keyBy: 'ip',
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '192.168.1.1' });
      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '192.168.1.1' });
      
      const ip1Response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: '192.168.1.1' 
      });
      expect(ip1Response.statusCode).toBe(429);
      
      const ip2Response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: '192.168.1.2' 
      });
      expect(ip2Response.statusCode).toBe(200);
    });

    it('should rate limit by header', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
        keyBy: { type: 'header', name: 'X-User-Id' },
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        headers: { 'X-User-Id': 'user1' } 
      });
      await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        headers: { 'X-User-Id': 'user1' } 
      });
      
      const user1Response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        headers: { 'X-User-Id': 'user1' } 
      });
      expect(user1Response.statusCode).toBe(429);
      
      const user2Response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        headers: { 'X-User-Id': 'user2' } 
      });
      expect(user2Response.statusCode).toBe(200);
    });

    it('should rate limit by custom key function', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
        keyBy: (req) => (req.query as { tenant?: string }).tenant || 'default',
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ method: 'GET', url: '/test?tenant=acme' });
      await fastify.inject({ method: 'GET', url: '/test?tenant=acme' });
      
      const acmeResponse = await fastify.inject({ method: 'GET', url: '/test?tenant=acme' });
      expect(acmeResponse.statusCode).toBe(429);
      
      const otherResponse = await fastify.inject({ method: 'GET', url: '/test?tenant=other' });
      expect(otherResponse.statusCode).toBe(200);
    });
  });

  describe('Whitelist and Blacklist', () => {
    it('should bypass rate limit for whitelisted keys', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
        whitelist: ['127.0.0.1', 'trusted-ip'],
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      for (let i = 0; i < 10; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/test', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('should block blacklisted keys', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 100,
        blacklist: ['bad-ip'],
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      const response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: 'bad-ip' 
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('Custom Rate Limit Handler', () => {
    it('should call custom handler when rate limited', async () => {
      const customHandler = jest.fn();
      
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 1,
        onRateLimited: customHandler,
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '127.0.0.1' });
      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '127.0.0.1' });

      expect(customHandler).toHaveBeenCalled();
    });

    it('should allow custom response in handler', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 1,
        onRateLimited: (req, reply) => {
          reply.code(429).send({ custom: 'rate limited!' });
        },
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      await fastify.inject({ method: 'GET', url: '/test', remoteAddress: '127.0.0.1' });
      const response = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: '127.0.0.1' 
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.payload)).toEqual({ custom: 'rate limited!' });
    });
  });

  describe('Route Level Configuration', () => {
    it('should support different limits per route', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 10,
      });

      fastify.register(rateLimiter);
      
      fastify.get('/public', {
        config: {
          rateLimit: {
            maxRequests: 100,
          },
        },
      }, async () => ({ status: 'public' }));

      fastify.get('/private', {
        config: {
          rateLimit: {
            maxRequests: 2,
          },
        },
      }, async () => ({ status: 'private' }));

      for (let i = 0; i < 50; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/public', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }

      await fastify.inject({ method: 'GET', url: '/private', remoteAddress: '127.0.0.1' });
      await fastify.inject({ method: 'GET', url: '/private', remoteAddress: '127.0.0.1' });
      const privateResponse = await fastify.inject({ 
        method: 'GET', 
        url: '/private', 
        remoteAddress: '127.0.0.1' 
      });
      expect(privateResponse.statusCode).toBe(429);
    });

    it('should disable rate limit for specific route', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
      });

      fastify.register(rateLimiter);
      
      fastify.get('/unlimited', {
        config: {
          rateLimit: false,
        },
      }, async () => ({ status: 'unlimited' }));

      fastify.get('/limited', async () => ({ status: 'limited' }));

      for (let i = 0; i < 10; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/unlimited', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }

      await fastify.inject({ method: 'GET', url: '/limited', remoteAddress: '127.0.0.1' });
      await fastify.inject({ method: 'GET', url: '/limited', remoteAddress: '127.0.0.1' });
      const limitedResponse = await fastify.inject({ 
        method: 'GET', 
        url: '/limited', 
        remoteAddress: '127.0.0.1' 
      });
      expect(limitedResponse.statusCode).toBe(429);
    });
  });

  describe('Token Bucket Algorithm', () => {
    it('should work with token bucket algorithm', async () => {
      const rateLimiter = createRateLimiter({
        redis: redis as any,
        algorithm: 'token-bucket',
        capacity: 3,
        refillRate: 1,
      });

      fastify.register(rateLimiter);
      fastify.get('/test', async () => ({ status: 'ok' }));

      for (let i = 0; i < 3; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/test', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }

      const blockedResponse = await fastify.inject({ 
        method: 'GET', 
        url: '/test', 
        remoteAddress: '127.0.0.1' 
      });
      expect(blockedResponse.statusCode).toBe(429);
    });
  });

  describe('Multiple Limiters with Different Key Prefix', () => {
    it('should isolate limiters by key prefix', async () => {
      const limiterA = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 2,
        keyPrefix: 'a',
      });

      const limiterB = createRateLimiter({
        redis: redis as any,
        algorithm: 'fixed-window',
        windowSeconds: 60,
        maxRequests: 5,
        keyPrefix: 'b',
      });

      fastify.register(async (fastify: FastifyInstance) => {
        fastify.register(limiterA);
        fastify.get('/a/test', async () => ({ status: 'a' }));
      });

      fastify.register(async (fastify: FastifyInstance) => {
        fastify.register(limiterB);
        fastify.get('/b/test', async () => ({ status: 'b' }));
      });

      for (let i = 0; i < 2; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/a/test', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }
      
      const aBlocked = await fastify.inject({ 
        method: 'GET', 
        url: '/a/test', 
        remoteAddress: '127.0.0.1' 
      });
      expect(aBlocked.statusCode).toBe(429);

      for (let i = 0; i < 5; i++) {
        const response = await fastify.inject({ 
          method: 'GET', 
          url: '/b/test', 
          remoteAddress: '127.0.0.1' 
        });
        expect(response.statusCode).toBe(200);
      }
      
      const bBlocked = await fastify.inject({ 
        method: 'GET', 
        url: '/b/test', 
        remoteAddress: '127.0.0.1' 
      });
      expect(bBlocked.statusCode).toBe(429);
    });
  });
});
