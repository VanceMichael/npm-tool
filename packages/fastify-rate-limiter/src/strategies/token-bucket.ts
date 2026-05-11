import type { RateLimitStrategy, RateLimitResult, RateLimitOptions } from '../types';

export class TokenBucketStrategy implements RateLimitStrategy {
  async check(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const { redis, capacity, refillRate, keyPrefix = 'rate-limit' } = options;
    const redisKey = `${keyPrefix}:tb:${key}`;
    
    const now = Date.now();
    
    const script = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      local data = redis.call('HMGET', key, 'tokens', 'lastUpdate')
      local tokens = tonumber(data[1])
      local lastUpdate = tonumber(data[2])
      
      if tokens == nil then
        tokens = capacity
        lastUpdate = now
      end
      
      local elapsed = (now - lastUpdate) / 1000
      local newTokens = math.min(capacity, tokens + elapsed * refillRate)
      
      if newTokens >= 1 then
        newTokens = newTokens - 1
        redis.call('HMSET', key, 'tokens', newTokens, 'lastUpdate', now)
        redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 60)
        return {1, math.floor(newTokens), capacity, now + math.floor((capacity - newTokens) / refillRate * 1000)}
      else
        local timeToNextToken = math.ceil((1 - newTokens) / refillRate * 1000)
        return {0, 0, capacity, now + timeToNextToken}
      end
    `;
    
    const result = await redis.eval(script, 1, redisKey, capacity, refillRate, now);
    const [allowed, remaining, limit, resetTime] = result as [number, number, number, number];
    
    return {
      allowed: allowed === 1,
      limit,
      remaining,
      resetTime,
    };
  }
}
