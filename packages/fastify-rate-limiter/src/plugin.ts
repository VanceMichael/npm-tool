import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getStrategy } from './strategies';
import { normalizeKeyExtractor, extractKey } from './utils/key-extractor';
import type { CreateRateLimiterOptions, RateLimitOptions, RateLimitResult } from './types';

function mergeOptions(
  defaults: RateLimitOptions,
  overrides?: Partial<CreateRateLimiterOptions> | false | true
): RateLimitOptions | null {
  if (overrides === false) {
    return null;
  }
  
  if (overrides === true || !overrides) {
    return defaults;
  }
  
  const keyExtractor = overrides.keyBy 
    ? normalizeKeyExtractor(overrides.keyBy) 
    : defaults.keyExtractor;
  
  return {
    ...defaults,
    ...overrides,
    algorithm: overrides.algorithm || defaults.algorithm,
    keyExtractor,
  } as RateLimitOptions;
}

export function createRateLimiter(pluginOptions: CreateRateLimiterOptions) {
  const keyExtractor = normalizeKeyExtractor(pluginOptions.keyBy);
  
  const defaultOptions: RateLimitOptions = {
    ...pluginOptions,
    algorithm: pluginOptions.algorithm || 'fixed-window',
    windowSeconds: pluginOptions.windowSeconds || 60,
    maxRequests: pluginOptions.maxRequests || 100,
    capacity: pluginOptions.capacity || 100,
    refillRate: pluginOptions.refillRate || 10,
    keyExtractor,
    keyPrefix: pluginOptions.keyPrefix || 'rate-limit',
  } as RateLimitOptions;

  const plugin: FastifyPluginAsync = fp(async (fastify) => {
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const routeConfig = (request.routeOptions.config as any)?.rateLimit as Partial<CreateRateLimiterOptions> | false | undefined;
      
      const mergedOptions = mergeOptions(defaultOptions, routeConfig);
      if (!mergedOptions) {
        return;
      }
      
      const strategy = getStrategy(mergedOptions.algorithm);
      
      const key = await extractKey(request, mergedOptions.keyExtractor);
      
      if (mergedOptions.whitelist?.includes(key)) {
        return;
      }
      
      if (mergedOptions.blacklist?.includes(key)) {
        reply.code(403).send({ error: 'Forbidden', message: 'You are blacklisted' });
        return;
      }
      
      const result = await strategy.check(key, mergedOptions);
      
      reply.header('X-RateLimit-Limit', result.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
      
      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        reply.header('Retry-After', Math.max(1, retryAfter));
        
        if (mergedOptions.onRateLimited) {
          await mergedOptions.onRateLimited(request, reply, result);
          if (reply.sent) {
            return;
          }
        }
        
        reply.code(429).send({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          limit: result.limit,
          remaining: result.remaining,
          reset: new Date(result.resetTime).toISOString(),
        });
        return;
      }
    });
  });

  return plugin;
}
