import type { RateLimitStrategy, RateLimitResult, TokenBucketOptions } from '../types'
import type { RateLimitStorage } from '../storage'

const TOKEN_BUCKET_SCRIPT = `
local stateKey = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local refillInterval = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local state = redis.call('GET', stateKey)
local tokens = capacity
local lastRefill = now

if state then
    local parts = {}
    for part in string.gmatch(state, '([^:]+)') do
        parts[#parts + 1] = part
    end
    tokens = tonumber(parts[1])
    lastRefill = tonumber(parts[2])
end

local elapsed = now - lastRefill
if elapsed > 0 then
    local refilled = math.floor(elapsed / refillInterval) * refillRate
    tokens = math.min(capacity, tokens + refilled)
    lastRefill = lastRefill + math.floor(elapsed / refillInterval) * refillInterval
end

local allowed = tokens >= 1
if allowed then
    tokens = tokens - 1
end

redis.call('SET', stateKey, tokens .. ':' .. lastRefill)

local nextRefill
if tokens >= capacity then
    nextRefill = now + refillInterval
else
    nextRefill = lastRefill + refillInterval
end

return {allowed and 1 or 0, tokens, capacity, nextRefill}
`

export class TokenBucketStrategy implements RateLimitStrategy {
  readonly algorithm = 'token-bucket' as const

  private readonly capacity: number
  private readonly refillRate: number
  private readonly refillIntervalSeconds: number
  private readonly storage: RateLimitStorage

  constructor(options: TokenBucketOptions, storage: RateLimitStorage) {
    this.capacity = options.capacity
    this.refillRate = options.refillRate
    this.refillIntervalSeconds = options.refillIntervalSeconds ?? 1
    this.storage = storage
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000)

    try {
      const result = await this.storage.eval(
        TOKEN_BUCKET_SCRIPT,
        [key],
        [this.capacity, this.refillRate, this.refillIntervalSeconds, now]
      ) as [number, number, number, number] | null

      const allowed = result?.[0] === 1
      const remaining = result?.[1] ?? this.capacity
      const resetAt = result?.[3] ?? now + this.refillIntervalSeconds

      return {
        allowed,
        remaining,
        resetAt,
        limit: this.capacity,
      }
    } catch (error) {
      return {
        allowed: true,
        remaining: this.capacity,
        resetAt: now + this.refillIntervalSeconds,
        limit: this.capacity,
      }
    }
  }

  async reset(key: string): Promise<void> {
    await this.storage.delete(key)
  }
}
