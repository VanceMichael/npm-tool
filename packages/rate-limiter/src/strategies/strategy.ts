export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface Strategy {
  consume(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}
