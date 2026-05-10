import type { FastifyRequest, FastifyReply } from 'fastify'

export type RateLimitAlgorithm = 'fixed-window' | 'token-bucket'

export interface KeyGeneratorFn {
  (request: FastifyRequest): string | Promise<string>
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  limit: number
}

export interface RateLimitStrategy {
  readonly algorithm: RateLimitAlgorithm
  check(key: string): Promise<RateLimitResult>
  reset(key: string): Promise<void>
}

export interface FixedWindowOptions {
  algorithm: 'fixed-window'
  windowSeconds: number
  maxRequests: number
}

export interface TokenBucketOptions {
  algorithm: 'token-bucket'
  capacity: number
  refillRate: number
  refillIntervalSeconds?: number
}

export type AlgorithmOptions = FixedWindowOptions | TokenBucketOptions

export interface WhitelistBlacklistOptions {
  whitelist?: string[]
  blacklist?: string[]
}

export interface RateLimitHandler {
  (request: FastifyRequest, reply: FastifyReply, result: RateLimitResult): void | Promise<void>
}

export interface KeyDimensionOptions {
  dimension?: 'ip' | 'header' | 'custom'
  headerName?: string
  keyGenerator?: KeyGeneratorFn
}

export type RateLimiterOptions = (FixedWindowOptions | TokenBucketOptions) &
  KeyDimensionOptions &
  WhitelistBlacklistOptions & {
    redis: {
      host: string
      port: number
      db?: number
      keyPrefix?: string
    }
    handler?: RateLimitHandler
    enableRouteOverride?: boolean
  }

export type RouteRateLimitConfig = Partial<RateLimiterOptions>
