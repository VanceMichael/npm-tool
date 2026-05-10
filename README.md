# @anthropic/rate-limiter

一个面向 Fastify 的限流中间件库，支持可插拔的限流策略（固定窗口 / 令牌桶），基于 Redis (ioredis) 存储，按路由粒度生效。

## 安装

```bash
npm install @anthropic/rate-limiter ioredis fastify
```

## 快速开始

```ts
import Fastify from 'fastify';
import Redis from 'ioredis';
import { createRateLimiter } from '@anthropic/rate-limiter';

const app = Fastify();
const redis = new Redis({ host: '127.0.0.1', port: 6379 });

// 创建一个固定窗口限流插件：每个 IP 每 60 秒最多 100 次请求
const rateLimiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowMs: 60_000,
  maxRequests: 100,
});

app.register(rateLimiter);

app.get('/api/data', async () => ({ data: 'hello' }));

app.listen({ port: 3000 });
```

## 限流维度

### 按 IP（默认）

```ts
createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowMs: 60_000,
  maxRequests: 100,
  // keyGenerator 默认使用 req.ip
});
```

### 按请求头

```ts
createRateLimiter({
  redis,
  keyGenerator: (req) => req.headers['x-user-id'] as string,
  algorithm: 'fixed-window',
  windowMs: 60_000,
  maxRequests: 100,
});
```

### 自定义 Key 函数

```ts
createRateLimiter({
  redis,
  keyGenerator: (req) => `${req.ip}:${req.url}`,
  algorithm: 'token-bucket',
  capacity: 50,
  refillRate: 10,
});
```

## 算法说明

### 固定窗口（Fixed Window）

将时间划分为固定长度的窗口（如每 60 秒一个窗口），在每个窗口内统计请求次数，超过阈值则拒绝。

**工作原理：**

1. 以 `windowMs` 为单位划分时间窗口，每个窗口对应一个 Redis key
2. 每次请求对当前窗口计数器 `INCR +1`
3. 若计数器值 ≤ `maxRequests`，放行；否则返回 429
4. 窗口过期后计数器自动归零

**优点：** 实现简单，内存占用低
**缺点：** 存在窗口边界突发问题——两个相邻窗口的交界处可能出现 2 倍阈值的突发流量

```
窗口1 (0-60s)        窗口2 (60-120s)
|██████████|---------|██████████|
  100次/60s            100次/60s
        ↑ 边界突发：最后1秒50次 + 下1秒50次 = 短时间内100次
```

### 令牌桶（Token Bucket）

桶中持有最多 `capacity` 个令牌，以 `refillRate`（个/秒）的速率持续补充。每次请求消耗 1 个令牌，桶空时拒绝。

**工作原理：**

1. 初始桶满（`capacity` 个令牌）
2. 每次请求前计算自上次补充以来经过的时间，按 `refillRate` 补充令牌（不超过 `capacity`）
3. 若桶中令牌 ≥ 1，消耗 1 个并放行；否则拒绝
4. 被拒绝时返回 `retryAfterMs`，表示需要等待多久才有新令牌

**优点：** 允许受控突发流量（短时间内消耗满桶令牌），同时保证长期平均速率不超过 `refillRate`
**缺点：** 实现稍复杂，Redis 存储量略大

```
容量: 10, 补充速率: 2/秒

时间  0s   1s   2s   3s   ...
令牌 [10] [10] [10] [8]  ...  (持续低流量)
令牌 [10] [9]  [8]  [7]  ...  (每秒1次)
令牌 [10] [1]  [拒绝] ...       (突发9次后桶近空)
```

## 白名单 / 黑名单

```ts
createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowMs: 60_000,
  maxRequests: 100,
  whitelist: ['internal-service', 'admin'],    // 这些 key 永远放行
  blacklist: ['banned-user-123'],               // 这些 key 永远拒绝
});
```

- **白名单**：匹配的 key 完全跳过限流检查，`remaining` 设为 `Infinity`
- **黑名单**：匹配的 key 直接返回 429，优先级高于白名单（同一 key 同时在两列表中，黑名单生效）

## 自定义超限响应

默认行为：返回 HTTP 429，带 `Retry-After` 响应头，JSON body：

```json
{ "error": "Too Many Requests", "retryAfter": 60 }
```

自定义：

```ts
createRateLimiter({
  redis,
  algorithm: 'token-bucket',
  capacity: 50,
  refillRate: 10,
  onExceeded: async (req, reply, retryAfterMs) => {
    reply.code(429);
    reply.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    reply.send({
      error: 'rate_limited',
      message: '请稍后再试',
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    });
  },
});
```

## 按路由粒度

通过 Fastify 的插件封装，不同路由注册不同限流插件：

```ts
import { createRateLimiter } from '@anthropic/rate-limiter';

// 全局默认限流
app.register(createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowMs: 60_000,
  maxRequests: 100,
}));

// /api/burst 路由使用令牌桶
app.register(async (instance) => {
  instance.register(createRateLimiter({
    redis,
    algorithm: 'token-bucket',
    capacity: 10,
    refillRate: 2,
    prefix: 'rl:burst',
  }));
  instance.get('/burst', async () => ({ ok: true }));
}, { prefix: '/api' });
```

## 对外暴露接口

### `createRateLimiter(options)`

工厂函数，返回一个 Fastify 插件（`FastifyPluginCallback`）。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `redis` | `Redis` (ioredis) | 是* | — | ioredis 实例，用于存储限流计数 |
| `strategy` | `Strategy` | 是* | — | 自定义策略实例，与 `redis` 二选一 |
| `algorithm` | `'fixed-window' \| 'token-bucket'` | 否 | `'fixed-window'` | 限流算法，仅在不传 `strategy` 时生效 |
| `keyGenerator` | `(req: FastifyRequest) => string \| Promise<string>` | 否 | `(req) => req.ip` | 限流维度 key 生成函数 |
| `windowMs` | `number` | 否 | `60000` | 固定窗口大小（毫秒） |
| `maxRequests` | `number` | 否 | `100` | 固定窗口内最大请求数 |
| `capacity` | `number` | 否 | `100` | 令牌桶容量 |
| `refillRate` | `number` | 否 | `10` | 令牌桶补充速率（个/秒） |
| `whitelist` | `string[]` | 否 | `[]` | 白名单 key 列表，跳过限流 |
| `blacklist` | `string[]` | 否 | `[]` | 黑名单 key 列表，直接拒绝 |
| `onExceeded` | `(req, reply, retryAfterMs) => void \| Promise<void>` | 否 | 返回 429 + Retry-After | 超限时的自定义响应处理 |
| `prefix` | `string` | 否 | `'rl:fw'` / `'rl:tb'` | Redis key 前缀 |

> *`redis` 和 `strategy` 至少提供一个。若提供 `strategy`，则忽略 `algorithm`/`windowMs`/`maxRequests`/`capacity`/`refillRate`。

### Strategy 接口

```ts
interface RateLimitResult {
  allowed: boolean;       // 是否放行
  remaining: number;      // 剩余配额
  retryAfterMs: number;   // 被拒绝时建议等待的毫秒数
}

interface Strategy {
  consume(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}
```

你可以实现自己的 `Strategy`，只需满足上述接口即可传入 `createRateLimiter({ strategy })`。

### 导出的类

| 导出名 | 说明 |
|--------|------|
| `FixedWindowStrategy` | 固定窗口策略实现 |
| `TokenBucketStrategy` | 令牌桶策略实现 |

### 请求装饰器

注册插件后，每个请求对象上会挂载 `rateLimitInfo` 属性：

```ts
interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  key: string;
}
```

可在后续钩子或 handler 中使用：

```ts
app.get('/api/data', async (req) => {
  console.log(req.rateLimitInfo.remaining); // 剩余配额
  return { data: 'ok' };
});
```

### 响应头

| 头 | 说明 |
|----|------|
| `X-RateLimit-Remaining` | 当前剩余配额（每次请求都设置） |
| `Retry-After` | 被拒绝时建议等待的秒数（默认 429 响应） |

## 中间件配置项一览

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `algorithm` | `'fixed-window' \| 'token-bucket'` | `'fixed-window'` | 限流算法 |
| `keyGenerator` | `(req) => string \| Promise<string>` | `(req) => req.ip` | 限流 key 生成函数 |
| `windowMs` | `number` | `60000` | 固定窗口时长（ms） |
| `maxRequests` | `number` | `100` | 固定窗口最大请求数 |
| `capacity` | `number` | `100` | 令牌桶容量 |
| `refillRate` | `number` | `10` | 令牌桶补充速率（个/秒） |
| `whitelist` | `string[]` | `[]` | 白名单 key |
| `blacklist` | `string[]` | `[]` | 黑名单 key |
| `onExceeded` | `(req, reply, retryAfterMs) => void \| Promise<void>` | 429 + Retry-After | 超限处理函数 |
| `redis` | `ioredis.Redis` | — | Redis 实例 |
| `strategy` | `Strategy` | — | 自定义策略实例 |
| `prefix` | `string` | `'rl:fw'` 或 `'rl:tb'` | Redis key 前缀 |

## 项目结构

```
├── packages/rate-limiter/        # 核心库
│   ├── src/
│   │   ├── index.ts              # createRateLimiter 工厂 + Fastify 插件
│   │   ├── types.ts              # 类型定义
│   │   ├── strategies/
│   │   │   ├── strategy.ts       # Strategy 接口
│   │   │   ├── fixed-window.ts   # 固定窗口策略
│   │   │   └── token-bucket.ts   # 令牌桶策略
│   │   └── __tests__/            # 单元测试
│   └── package.json
├── examples/fastify-app/          # 演示服务
│   └── src/index.ts
└── package.json                   # monorepo 根
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 运行示例（需要本地 Redis）
npm run example
```

## License

MIT
