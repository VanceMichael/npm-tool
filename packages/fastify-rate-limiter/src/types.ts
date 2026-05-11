import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

export type RateLimitAlgorithm = 'fixed-window' | 'token-bucket';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

export interface RateLimitStrategy {
  check(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
}

export interface FixedWindowOptions {
  windowSeconds: number;
  maxRequests: number;
}

export interface TokenBucketOptions {
  capacity: number;
  refillRate: number;
}

export interface KeyExtractor {
  type: 'ip' | 'header' | 'custom';
  headerName?: string;
  customFn?: (request: FastifyRequest) => string | Promise<string>;
}

export interface RateLimitOptions extends FixedWindowOptions, TokenBucketOptions {
  algorithm: RateLimitAlgorithm;
  keyExtractor: KeyExtractor;
  redis: Redis;
  keyPrefix?: string;
  whitelist?: string[];
  blacklist?: string[];
  onRateLimited?: (request: FastifyRequest, reply: FastifyReply, result: RateLimitResult) => void | Promise<void>;
}

export interface CreateRateLimiterOptions
  extends Partial<Omit<RateLimitOptions, 'redis' | 'keyExtractor' | 'algorithm'>> {
  redis: Redis;
  algorithm?: RateLimitAlgorithm;
  keyBy?: 'ip' | { type: 'header'; name: string } | ((request: FastifyRequest) => string | Promise<string>);
}

export interface FastifyRateLimitPluginOptions
  extends Partial<Omit<CreateRateLimiterOptions, 'redis'>> {
  redis?: Redis;
}
