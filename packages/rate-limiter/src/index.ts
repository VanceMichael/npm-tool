import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import type { Strategy, RateLimitResult } from './strategies/strategy';
import { FixedWindowStrategy } from './strategies/fixed-window';
import { TokenBucketStrategy } from './strategies/token-bucket';
import type {
  RateLimitOptions,
  RateLimitAlgorithm,
  KeyGenerator,
  RateLimitInfo,
} from './types';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_CAPACITY = 100;
const DEFAULT_REFILL_RATE = 10;

function resolveKeyByIp(req: FastifyRequest): string {
  return req.ip;
}

function createStrategy(
  algorithm: RateLimitAlgorithm,
  redis: Redis,
  options: RateLimitOptions,
): Strategy {
  switch (algorithm) {
    case 'token-bucket':
      return new TokenBucketStrategy(redis, {
        capacity: options.capacity ?? DEFAULT_CAPACITY,
        refillRate: options.refillRate ?? DEFAULT_REFILL_RATE,
        prefix: options.prefix,
      });
    case 'fixed-window':
    default:
      return new FixedWindowStrategy(redis, {
        windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
        maxRequests: options.maxRequests ?? DEFAULT_MAX_REQUESTS,
        prefix: options.prefix,
      });
  }
}

async function defaultOnExceeded(
  _req: FastifyRequest,
  reply: FastifyReply,
  retryAfterMs: number,
): Promise<void> {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  reply.code(429);
  reply.header('Retry-After', String(retryAfterSec));
  reply.send({ error: 'Too Many Requests', retryAfter: retryAfterSec });
}

export function createRateLimiter(options: RateLimitOptions = {}) {
  const algorithm: RateLimitAlgorithm = options.algorithm ?? 'fixed-window';
  const keyGenerator: KeyGenerator = options.keyGenerator ?? resolveKeyByIp;
  const whitelist = new Set(options.whitelist ?? []);
  const blacklist = new Set(options.blacklist ?? []);
  const onExceeded = options.onExceeded ?? defaultOnExceeded;

  const plugin = fp(
    async (fastify: FastifyInstance, _opts: Record<string, unknown>) => {
      let strategy: Strategy;

      if (options.strategy) {
        strategy = options.strategy;
      } else {
        const redis = options.redis;
        if (!redis) {
          throw new Error(
            'Either "redis" (ioredis instance) or "strategy" must be provided in createRateLimiter options',
          );
        }
        strategy = createStrategy(algorithm, redis, options);
      }

      if (!fastify.hasRequestDecorator('rateLimitInfo')) {
        fastify.decorateRequest('rateLimitInfo', null);
      }

      fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        const key = await keyGenerator(req);

        if (blacklist.has(key)) {
          (req as any).rateLimitInfo = {
            allowed: false,
            remaining: 0,
            retryAfterMs: Infinity,
            key,
          };
          await onExceeded(req, reply, Infinity);
          return reply;
        }

        if (whitelist.has(key)) {
          (req as any).rateLimitInfo = {
            allowed: true,
            remaining: Infinity,
            retryAfterMs: 0,
            key,
          };
          return;
        }

        const result: RateLimitResult = await strategy.consume(key);
        const info: RateLimitInfo = {
          ...result,
          key,
        };
        (req as any).rateLimitInfo = info;

        reply.header('X-RateLimit-Remaining', String(result.remaining));

        if (!result.allowed) {
          await onExceeded(req, reply, result.retryAfterMs);
          return reply;
        }
      });
    },
    {
      name: '@anthropic/rate-limiter',
      fastify: '4.x',
    },
  );

  return plugin;
}

export { FixedWindowStrategy } from './strategies/fixed-window';
export { TokenBucketStrategy } from './strategies/token-bucket';
export type { Strategy, RateLimitResult } from './strategies/strategy';
export type {
  RateLimitOptions,
  RateLimitAlgorithm,
  KeyGenerator,
  RateLimitInfo,
} from './types';
