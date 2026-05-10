import Fastify from 'fastify';
import Redis from 'ioredis';
import { createRateLimiter } from '@anthropic/rate-limiter';

const app = Fastify({ logger: true });

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const fixedWindowLimiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowMs: 10_000,
  maxRequests: 5,
  keyGenerator: (req) => req.headers['x-user-id'] as string ?? req.ip,
  whitelist: ['internal-service'],
  onExceeded: async (req, reply, retryAfterMs) => {
    reply.code(429);
    reply.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    reply.send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
      retryAfter: Math.ceil(retryAfterMs / 1000),
    });
  },
});

const tokenBucketLimiter = createRateLimiter({
  redis,
  algorithm: 'token-bucket',
  capacity: 10,
  refillRate: 2,
  prefix: 'rl:tb:api',
  blacklist: ['banned-user'],
});

app.register(fixedWindowLimiter);

app.get('/', async () => {
  return { message: 'Hello! You are within the rate limit.' };
});

app.get('/limited', async () => {
  return { message: 'This route uses fixed-window rate limiting (5 req / 10s per user).' };
});

app.register(
  async (instance) => {
    instance.register(tokenBucketLimiter);
    instance.get('/burst', async () => {
      return { message: 'This route uses token-bucket (10 tokens, 2/sec refill).' };
    });
  },
  { prefix: '/api' },
);

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Server running on http://0.0.0.0:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
