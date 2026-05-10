import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify'
import type {
  RateLimiterOptions,
  RateLimitStrategy,
  RouteRateLimitConfig,
  RateLimitResult,
} from './types'
import { RateLimitStorage } from './storage'
import { FixedWindowStrategy, TokenBucketStrategy } from './strategies'

const defaultHandler = (request: FastifyRequest, reply: FastifyReply, result: RateLimitResult) => {
  const now = Math.floor(Date.now() / 1000)
  const retryAfter = Math.max(1, result.resetAt - now)
  reply
    .code(429)
    .header('Retry-After', String(retryAfter))
    .header('X-RateLimit-Limit', String(result.limit))
    .header('X-RateLimit-Remaining', String(result.remaining))
    .header('X-RateLimit-Reset', String(result.resetAt))
    .send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
      statusCode: 429,
      retryAfter,
    })
}

function createStrategy(
  options: RateLimiterOptions,
  storage: RateLimitStorage
): RateLimitStrategy {
  const opts = options as any
  if (opts.algorithm === 'fixed-window') {
    return new FixedWindowStrategy(opts, storage)
  }
  return new TokenBucketStrategy(opts, storage)
}

async function generateKey(
  request: FastifyRequest,
  options: RateLimiterOptions | RouteRateLimitConfig
): Promise<string> {
  const dimension = options.dimension || 'ip'
  const routeKey = request.routerPath || request.url

  if (dimension === 'custom' && options.keyGenerator) {
    const customKey = await options.keyGenerator(request)
    return `${routeKey}:custom:${customKey}`
  }

  if (dimension === 'header') {
    const headerName = options.headerName || 'X-User-Id'
    const headerValue = request.headers[headerName.toLowerCase()] || 'unknown'
    return `${routeKey}:header:${headerValue}`
  }

  return `${routeKey}:ip:${request.ip}`
}

function checkWhitelistBlacklist(
  key: string,
  options: RateLimiterOptions | RouteRateLimitConfig
): { skip: boolean; block: boolean } {
  const actualKey = key.split(':').slice(-1)[0]

  if (options.blacklist?.includes(actualKey)) {
    return { skip: false, block: true }
  }

  if (options.whitelist?.includes(actualKey)) {
    return { skip: true, block: false }
  }

  return { skip: false, block: false }
}

function mergeOptions(
  base: RateLimiterOptions,
  route?: RouteRateLimitConfig
): RateLimiterOptions {
  if (!route) return base
  return { ...base, ...route } as RateLimiterOptions
}

export function createRateLimiter(options: RateLimiterOptions) {
  const storage = new RateLimitStorage(options.redis, (options as any)._testRedisClient)
  const defaultStrategy = createStrategy(options, storage)
  const handler = options.handler || defaultHandler

  const plugin: FastifyPluginAsync<RateLimiterOptions> = fp(async (fastify: FastifyInstance) => {
    if (!(fastify as any).hasRequestDecorator('rateLimit')) {
      fastify.decorateRequest('rateLimit', null)
    }

    fastify.addHook('onRequest', async (request, reply) => {
      const routeConfig = (request.routeOptions?.config as any)?.rateLimit as RouteRateLimitConfig | undefined
      const mergedOptions = mergeOptions(options, routeConfig)

      const key = await generateKey(request, mergedOptions)
      const { skip, block } = checkWhitelistBlacklist(key, mergedOptions)

      if (block) {
        reply.code(403).send({
          error: 'Forbidden',
          message: 'You are blocked by rate limiter',
          statusCode: 403,
        })
        return
      }

      if (skip) {
        return
      }

      let strategy = defaultStrategy
      if (routeConfig && (routeConfig as any).algorithm !== undefined) {
        strategy = createStrategy(mergedOptions as RateLimiterOptions, storage)
      }

      const result = await strategy.check(key)
      ;(request as any).rateLimit = {
        result,
        key,
        strategy: strategy.algorithm,
      }

      reply.header('X-RateLimit-Limit', String(result.limit))
      reply.header('X-RateLimit-Remaining', String(result.remaining))
      reply.header('X-RateLimit-Reset', String(result.resetAt))

      if (!result.allowed) {
        await handler(request, reply, result)
      }
    })
  })

  return Object.assign(plugin, {
    storage,
    getStorage: () => storage,
    close: async () => {
      await storage.disconnect()
    },
  })
}

export type RateLimiterPlugin = ReturnType<typeof createRateLimiter>
