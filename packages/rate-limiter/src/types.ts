import type { FastifyRequest, FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import type { Strategy } from './strategies/strategy';

export type KeyGenerator = (req: FastifyRequest) => string | Promise<string>;

export type RateLimitAlgorithm = 'fixed-window' | 'token-bucket';

export interface RateLimitOptions {
  algorithm?: RateLimitAlgorithm;
  keyGenerator?: KeyGenerator;
  windowMs?: number;
  maxRequests?: number;
  capacity?: number;
  refillRate?: number;
  whitelist?: string[];
  blacklist?: string[];
  onExceeded?: (req: FastifyRequest, reply: FastifyReply, retryAfterMs: number) => void | Promise<void>;
  strategy?: Strategy;
  redis?: Redis;
  prefix?: string;
}

export interface RateLimitPluginOptions extends RateLimitOptions {}

export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  key: string;
}
