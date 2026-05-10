import type { RateLimitStrategy, RateLimitResult, FixedWindowOptions } from '../types'
import type { RateLimitStorage } from '../storage'

const INCR_SCRIPT = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

local current = redis.call('GET', key)
if current == false then
    redis.call('SET', key, 1)
    redis.call('EXPIRE', key, window)
    return {1, now + window}
end

local newCount = tonumber(current) + 1
redis.call('SET', key, newCount, 'KEEPTTL')

local ttl = redis.call('TTL', key)
if ttl == -1 then
    redis.call('EXPIRE', key, window)
    ttl = window
end

return {newCount, now + ttl}
`

export class FixedWindowStrategy implements RateLimitStrategy {
  readonly algorithm = 'fixed-window' as const

  private readonly windowSeconds: number
  private readonly maxRequests: number
  private readonly storage: RateLimitStorage

  constructor(options: FixedWindowOptions, storage: RateLimitStorage) {
    this.windowSeconds = options.windowSeconds
    this.maxRequests = options.maxRequests
    this.storage = storage
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000)

    try {
      const result = await this.storage.eval(
        INCR_SCRIPT,
        [key],
        [this.windowSeconds, now]
      ) as [number, number] | null

      const count = result?.[0] ?? 1
      const resetAt = result?.[1] ?? now + this.windowSeconds
      const allowed = count <= this.maxRequests
      const remaining = allowed ? this.maxRequests - count : 0

      return {
        allowed,
        remaining,
        resetAt,
        limit: this.maxRequests,
      }
    } catch (error) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: now + this.windowSeconds,
        limit: this.maxRequests,
      }
    }
  }

  async reset(key: string): Promise<void> {
    await this.storage.delete(key)
  }
}
