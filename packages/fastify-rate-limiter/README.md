# fastify-rate-limiter

一个基于 Fastify 的限流中间件，支持多种限流策略（固定窗口、令牌桶），使用 Redis 存储，支持路由粒度配置。

## 特性

- 🚀 **Fastify 原生插件，高性能**
- 🔄 **两种限流算法**：固定窗口 (Fixed Window) 和 令牌桶 (Token Bucket)
- 🎯 **灵活的限流维度**：按 IP、Header、自定义函数
- 🚦 **路由级配置**：不同路由可配置不同限流规则
- 📋 **黑白名单**：支持白名单绕过和黑名单拦截
- 🎨 **自定义响应**：超时时可自定义响应内容
- 🔒 **Redis 原子操作**：Lua 脚本保证并发安全
- 🧪 **完整测试覆盖**：边界场景、并发场景

## 安装

```bash
npm install fastify-rate-limiter ioredis
```

## 快速开始

```typescript
import Fastify from 'fastify';
import Redis from 'ioredis';
import { createRateLimiter } from 'fastify-rate-limiter';

const fastify = Fastify();
const redis = new Redis();

const rateLimiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  keyBy: 'ip',
});

fastify.register(rateLimiter);

fastify.get('/', async () => ({ hello: 'world' }));

fastify.listen({ port: 3000 });
```

## 对外接口

| 接口 | 说明 |
|------|------|
| `createRateLimiter(options)` | 工厂函数，返回 Fastify 插件 |
| `FixedWindowStrategy` | 固定窗口策略类 |
| `TokenBucketStrategy` | 令牌桶策略类 |
| `getStrategy(algorithm)` | 获取策略工厂函数 |

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `redis` | `Redis` | 必填 | ioredis 客户端实例 |
| `algorithm` | `'fixed-window' \| 'token-bucket'` | `'fixed-window'` | 限流算法 |
| `keyBy` | `'ip' \| { type: 'header'; name: string } \| Function` | `'ip'` | 限流维度 |
| `windowSeconds` | `number` | `60` | 固定窗口时间（秒） |
| `maxRequests` | `number` | `100` | 固定窗口最大请求数 |
| `capacity` | `number` | `100` | 令牌桶容量 |
| `refillRate` | `number` | `10` | 令牌桶每秒补充速率 |
| `keyPrefix` | `string` | `'rate-limit'` | Redis key 前缀 |
| `whitelist` | `string[]` | `undefined` | 白名单 key 列表 |
| `blacklist` | `string[]` | `undefined` | 黑名单 key 列表 |
| `onRateLimited` | `Function` | `undefined` | 自定义限流响应 handler |

## 使用示例

### 1. 按 IP 限流（固定窗口）

```typescript
const limiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  keyBy: 'ip',
});
```

### 2. 按 Header 限流（令牌桶）

```typescript
const limiter = createRateLimiter({
  redis,
  algorithm: 'token-bucket',
  capacity: 50,
  refillRate: 5,
  keyBy: { type: 'header', name: 'X-User-Id' },
});
```

### 3. 自定义 key 函数

```typescript
const limiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 1000,
  keyBy: (req) => (req.query as { tenant?: string }).tenant || 'default',
});
```

### 4. 路由级配置（推荐用法）

推荐创建一个全局 limiter，然后通过路由配置来覆盖不同路由的参数：

```typescript
const limiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  keyPrefix: 'myapp',
});

fastify.register(limiter);

fastify.get('/public', async () => ({ status: 'ok' }));

fastify.get('/private', {
  config: {
    rateLimit: {
      maxRequests: 10,
      windowSeconds: 30,
    },
  },
}, async () => ({ status: 'private' }));

fastify.get('/unlimited', {
  config: {
    rateLimit: false,
  },
}, async () => ({ status: 'unlimited' }));
```

### 5. 黑白名单 + 自定义响应

```typescript
const limiter = createRateLimiter({
  redis,
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 100,
  whitelist: ['127.0.0.1', 'admin'],
  blacklist: ['spammer-ip'],
  onRateLimited: (req, reply, result) => {
    reply.code(429).send({
      error: 'Too Many Requests',
      message: '请稍后再试',
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
    });
  },
});
```

## 算法说明

### 固定窗口 (Fixed Window)

**原理**：将时间轴划分为固定大小的窗口，每个窗口内统计请求数，超过阈值则限流。

**优点**：
- 实现简单，内存占用小
- 理解容易

**缺点**：
- 存在"边界问题：窗口切换时可能出现双倍请求

**适用场景**：
- 对精度要求不高的场景
- 简单的 API 限流

### 令牌桶 (Token Bucket)

**原理**：桶中存放令牌，令牌以固定速率补充，请求消耗令牌，无令牌时限流。

**优点**：
- 平滑限流，允许突发流量
- 精度更高的流量控制

**缺点**：
- 实现相对复杂

**适用场景**：
- 需要平滑限流的场景
- 允许一定突发流量的 API

## 响应头

限流中间件会自动添加以下响应头：

| Header | 说明 |
|--------|------|
| `X-RateLimit-Limit` | 当前时间窗口的最大请求数 |
| `X-RateLimit-Remaining` | 当前时间窗口剩余请求数 |
| `X-RateLimit-Reset` | 限流重置的时间戳（秒） |
| `Retry-After` | 限流时返回，需要等待的秒数 |

## 运行测试

```bash
npm test
```

## License

MIT
