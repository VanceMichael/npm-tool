import Fastify from 'fastify';
import Redis from 'ioredis';
import { createRateLimiter } from 'fastify-rate-limiter';

const fastify = Fastify({ logger: true });
const redis = new Redis({ host: 'localhost', port: 6379 });

const rateLimiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  keyBy: 'ip',
});

fastify.register(rateLimiter);

fastify.get('/public', {
  config: {
    rateLimit: {
      maxRequests: 10,
      windowSeconds: 60,
      keyPrefix: 'example:public',
    },
  },
}, async () => ({
  message: 'This route uses fixed window rate limiting (10 req/min by IP)',
}));

fastify.get('/api/user', {
  config: {
    rateLimit: {
      maxRequests: 5,
      windowSeconds: 30,
      keyPrefix: 'example:user',
    },
  },
}, async () => ({
  message: 'This route has stricter limits: 5 req/30s by IP',
}));

fastify.register(async (fastify) => {
  const tokenBucketLimiter = createRateLimiter({
    redis,
    algorithm: 'token-bucket',
    capacity: 15,
    refillRate: 2,
    keyBy: { type: 'header', name: 'X-User-Id' },
    keyPrefix: 'example:tb',
  });

  fastify.register(tokenBucketLimiter);
  fastify.get('/bucket', async () => ({
    message: 'This route uses token bucket (15 capacity, 2/s refill by X-User-Id)',
  }));
}, { prefix: '/token' });

fastify.get('/custom/tenant', {
  config: {
    rateLimit: {
      algorithm: 'fixed-window' as const,
      windowSeconds: 30,
      maxRequests: 5,
      keyBy: (req: any) => (req.query as { tenant?: string }).tenant || 'default',
      keyPrefix: 'example:tenant',
      whitelist: ['admin', 'system'],
      blacklist: ['spammer'],
      onRateLimited: (req: any, reply: any) => {
        reply.code(429).send({
          error: 'Too Many Requests',
          message: 'Please slow down!',
          custom: true,
        });
      },
    },
  },
}, async (req) => ({
  message: `Tenant rate limiting for: ${(req.query as { tenant?: string }).tenant || 'default'}`,
}));

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running on http://localhost:3000');
    console.log('');
    console.log('Available routes:');
    console.log('  GET /public          - Fixed window (10 req/min by IP)');
    console.log('  GET /api/user        - Fixed window (5 req/30s by IP, stricter limits)');
    console.log('  GET /token/bucket    - Token bucket (by X-User-Id header)');
    console.log('  GET /custom/tenant   - Custom key (by ?tenant= query param)');
    console.log('');
    console.log('Test commands:');
    console.log('  for i in {1..12}; do curl http://localhost:3000/public -I 2>&1 | grep -E "(HTTP|X-RateLimit|Retry)"; echo "---"; done');
    console.log('  for i in {1..18}; do curl -H "X-User-Id: user1" http://localhost:3000/token/bucket -I 2>&1 | grep -E "(HTTP|X-RateLimit)"; echo "---"; done');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
