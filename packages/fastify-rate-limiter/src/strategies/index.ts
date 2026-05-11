import { FixedWindowStrategy } from './fixed-window';
import { TokenBucketStrategy } from './token-bucket';
import type { RateLimitStrategy, RateLimitAlgorithm } from '../types';

const strategies = new Map<RateLimitAlgorithm, RateLimitStrategy>();

strategies.set('fixed-window', new FixedWindowStrategy());
strategies.set('token-bucket', new TokenBucketStrategy());

export function getStrategy(algorithm: RateLimitAlgorithm): RateLimitStrategy {
  const strategy = strategies.get(algorithm);
  if (!strategy) {
    throw new Error(`Unsupported rate limit algorithm: ${algorithm}`);
  }
  return strategy;
}

export { FixedWindowStrategy, TokenBucketStrategy };
export type { RateLimitStrategy };
