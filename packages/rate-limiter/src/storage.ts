import Redis from 'ioredis'

export interface RedisConfig {
  host: string
  port: number
  db?: number
  keyPrefix?: string
}

export class RateLimitStorage {
  private readonly redis: Redis
  private readonly keyPrefix: string

  constructor(config: RedisConfig, customClient?: Redis) {
    this.keyPrefix = config.keyPrefix || 'rl:'
    if (customClient) {
      this.redis = customClient
    } else {
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        db: config.db ?? 0,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
      })
    }
  }

  getClient(): Redis {
    return this.redis
  }

  private formatKey(key: string): string {
    return `${this.keyPrefix}${key}`
  }

  async increment(key: string, ttlSeconds: number): Promise<{ count: number; firstSet: boolean }> {
    const formattedKey = this.formatKey(key)
    const pipeline = this.redis.pipeline()
    pipeline.incr(formattedKey)
    pipeline.ttl(formattedKey)
    const results = await pipeline.exec()

    const count = results?.[0]?.[1] as number
    const ttl = results?.[1]?.[1] as number

    const firstSet = count === 1 || ttl === -1
    if (firstSet && ttl === -1) {
      await this.redis.expire(formattedKey, ttlSeconds)
    }

    return { count, firstSet }
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.formatKey(key))
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.redis.set(this.formatKey(key), value, 'EX', ttlSeconds)
    } else {
      await this.redis.set(this.formatKey(key), value)
    }
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const formattedKeys = keys.map((k) => this.formatKey(k))
    return this.redis.eval(script, formattedKeys.length, ...formattedKeys, ...args)
  }

  async delete(key: string): Promise<number> {
    return this.redis.del(this.formatKey(key))
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
  }
}
