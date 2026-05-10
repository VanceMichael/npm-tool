# fastify-rate-limiter

一个基于 Redis 的 Fastify 限流中间件库，支持固定窗口（Fixed Window）和令牌桶（Token Bucket）两种限流算法，按路由粒度生效。

## 项目结构

```
.
├── packages/
│   └── rate-limiter/          # 核心库代码
│       ├── src/
│       │   ├── strategies/    # 限流算法实现
│       │   ├── types.ts       # 类型定义
│       │   ├── storage.ts     # Redis 存储层
│       │   ├── plugin.ts      # Fastify 插件实现
│       │   └── index.ts       # 导出入口
│       └── tests/             # 单元测试
└── examples/
    └── basic/                 # 示例服务
```

## 安装

```bash
npm install @your-org/fastify-rate-limiter ioredis fastify
```

## 快速开始

```typescript
import Fastify from 'fastify'
import { createRateLimiter } from '@your-org/fastify-rate-limiter'

const fastify = Fastify()

const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  dimension: 'ip',
  redis: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'myapp:',
  },
})

fastify.register(limiter)

fastify.get('/api/test', async () => {
  return { message: 'Hello!' }
})

await fastify.listen({ port: 3000 })
```

## 对外暴露接口

| 接口 | 类型 | 说明 |
|------|------|------|
| `createRateLimiter(options)` | 工厂函数 | 创建 Fastify 限流插件实例 |
| `RateLimitStrategy` | 接口 | 限流算法策略接口 |
| `FixedWindowStrategy` | 类 | 固定窗口算法实现 |
| `TokenBucketStrategy` | 类 | 令牌桶算法实现 |
| `RateLimitStorage` | 类 | Redis 存储封装类 |

## 配置项说明

### 通用配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `algorithm` | `'fixed-window' \| 'token-bucket'` | 必填 | 限流算法选择 |
| `dimension` | `'ip' \| 'header' \| 'custom'` | `'ip'` | 限流维度 |
| `headerName` | `string` | `'X-User-Id'` | header 维度时使用的 header 名 |
| `keyGenerator` | `(req) => string \| Promise<string>` | - | 自定义维度时的 key 生成函数 |
| `whitelist` | `string[]` | `[]` | 白名单 key 列表，跳过限流 |
| `blacklist` | `string[]` | `[]` | 黑名单 key 列表，直接拒绝 |
| `handler` | `(req, reply, result) => void` | 默认 429 响应 | 自定义超限响应处理 |
| `redis.host` | `string` | 必填 | Redis 主机地址 |
| `redis.port` | `number` | 必填 | Redis 端口 |
| `redis.db` | `number` | `0` | Redis 数据库编号 |
| `redis.keyPrefix` | `string` | `'rl:'` | Redis key 前缀 |

### Fixed Window 算法配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `windowSeconds` | `number` | 时间窗口大小（秒） |
| `maxRequests` | `number` | 窗口内最大请求数 |

### Token Bucket 算法配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `capacity` | `number` | - | 令牌桶最大容量 |
| `refillRate` | `number` | - | 每次补充的令牌数 |
| `refillIntervalSeconds` | `number` | `1` | 令牌补充间隔（秒） |

## 限流算法说明

### 固定窗口（Fixed Window）

**原理**：将时间划分为固定大小的窗口（如 60 秒），每个窗口内统计请求数，超过阈值则拒绝。

**优点**：
- 实现简单，内存占用小
- 易于理解和调试

**缺点**：
- 存在"窗口边界问题"：在两个窗口交界处可能出现突发流量（如 59 秒和 61 秒各发 100 次，实际 2 秒内有 200 次）

**适用场景**：对精度要求不高的通用限流场景。

### 令牌桶（Token Bucket）

**原理**：桶中初始有 N 个令牌，每个请求消耗 1 个令牌；按固定速率向桶中补充令牌，桶满则丢弃。

**优点**：
- 可以承受一定程度的突发流量（桶中有剩余令牌时）
- 限流更平滑，无窗口边界问题

**缺点**：
- 实现略复杂
- 需要存储桶状态（当前令牌数、上次补充时间）

**适用场景**：需要平滑限流或允许突发流量的场景。

## 使用示例

### 按 IP 限流（固定窗口）

```typescript
const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  dimension: 'ip',
  redis: { host: 'localhost', port: 6379 },
})
```

### 按 Header 限流（令牌桶）

```typescript
const limiter = createRateLimiter({
  algorithm: 'token-bucket',
  capacity: 50,
  refillRate: 2,
  refillIntervalSeconds: 1,
  dimension: 'header',
  headerName: 'X-User-Id',
  redis: { host: 'localhost', port: 6379 },
})
```

### 自定义 Key 生成器

```typescript
const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 30,
  maxRequests: 10,
  dimension: 'custom',
  keyGenerator: (req) => {
    return req.headers['x-api-key'] as string || 'anonymous'
  },
  redis: { host: 'localhost', port: 6379 },
})
```

### 白名单和黑名单

```typescript
const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  dimension: 'header',
  headerName: 'X-User-Id',
  whitelist: ['internal-service', 'admin'],
  blacklist: ['spammer-123', 'malicious-user'],
  redis: { host: 'localhost', port: 6379 },
})
```

### 自定义超限响应

```typescript
const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  dimension: 'ip',
  redis: { host: 'localhost', port: 6379 },
  handler: (req, reply, result) => {
    const retryAfter = result.resetAt - Math.floor(Date.now() / 1000)
    reply.code(429).header('Retry-After', String(retryAfter)).send({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `请在 ${retryAfter} 秒后重试`,
      docs: 'https://docs.example.com/rate-limits',
    })
  },
})
```

## 运行测试

```bash
# 安装依赖
npm install

# 运行测试
npm run test

# 运行示例
npm run example
```

## 发布到 npm

```bash
cd packages/rate-limiter
npm run build
npm publish --access public
```

## License

MIT
