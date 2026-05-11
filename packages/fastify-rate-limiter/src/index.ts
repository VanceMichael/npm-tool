export { createRateLimiter } from './plugin';
export { FixedWindowStrategy, TokenBucketStrategy, getStrategy } from './strategies';
export { normalizeKeyExtractor, extractKey } from './utils/key-extractor';
export type {
  RateLimitAlgorithm,
  RateLimitResult,
  RateLimitStrategy,
  FixedWindowOptions,
  TokenBucketOptions,
  KeyExtractor,
  RateLimitOptions,
  CreateRateLimiterOptions,
  FastifyRateLimitPluginOptions,
} from './types';
