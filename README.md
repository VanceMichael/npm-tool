# Fastify Rate Limiter Monorepo

一个基于 Fastify 的限流中间件 monorepo 项目。

## 项目结构

```
.
├── packages/
│   ├── fastify-rate-limiter/    # 限流中间件库
│   │   ├── src/
│   │   │   ├── strategies/      # 限流策略实现
│   │   │   ├── utils/           # 工具函数
│   │   │   ├── types.ts         # 类型定义
│   │   │   ├── plugin.ts        # 插件核心逻辑
│   │   │   └── index.ts         # 入口文件
│   │   ├── test/                # 单元测试
│   │   └── README.md            # 库文档
│   └── example/                 # 示例服务
│       └── src/index.ts
└── package.json
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

### 构建库

```bash
npm run build
```

### 运行示例服务

```bash
# 需要先启动 Redis
npm run example
```

## 功能特性

详见 [fastify-rate-limiter README](./packages/fastify-rate-limiter/README.md)

## License

MIT
