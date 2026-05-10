import Fastify from 'fastify'
import { createRateLimiter } from '@your-org/fastify-rate-limiter'

const fastify = Fastify({
  logger: true,
})

const fixedWindowLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 60,
  maxRequests: 10,
  dimension: 'ip',
  redis: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'example:fw:',
  },
})

const tokenBucketLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  capacity: 20,
  refillRate: 2,
  refillIntervalSeconds: 1,
  dimension: 'header',
  headerName: 'X-User-Id',
  redis: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'example:tb:',
  },
  whitelist: ['admin-user'],
})

const customKeyLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  windowSeconds: 30,
  maxRequests: 5,
  dimension: 'custom',
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string | undefined
    return apiKey || 'anonymous'
  },
  redis: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'example:custom:',
  },
  handler: (req, reply, result) => {
    const retryAfter = result.resetAt - Math.floor(Date.now() / 1000)
    reply.code(429).send({
      error: 'API_KEY_RATE_LIMITED',
      message: 'Too many requests for this API key',
      retryAfter,
    })
  },
})

fastify.register(fixedWindowLimiter)

fastify.get('/', async () => {
  return { message: 'Hello World! (Fixed Window by IP) - 10 req/min' }
})

fastify.get('/api/token-bucket', {
  preHandler: async (request, reply) => {
    const strategy = tokenBucketLimiter.getStorage()
    const result = await strategy.getClient().get('test')
    console.log('Token bucket route accessed', result)
  },
}, async () => {
  return { message: 'This route uses global fixed-window limiter' }
})

fastify.register(async (instance) => {
  instance.register(tokenBucketLimiter)

  instance.post('/api/protected', async () => {
    return { message: 'Protected endpoint with Token Bucket - 20 capacity, 2 tokens/sec' }
  })
})

fastify.register(async (instance) => {
  instance.register(customKeyLimiter)

  instance.get('/api/custom-key', async () => {
    return { message: 'Custom key based on X-API-Key header - 5 req/30s' }
  })
})

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
    console.log('Server is running on http://localhost:3000')
    console.log('')
    console.log('Test endpoints:')
    console.log('  GET  http://localhost:3000/              - Fixed Window by IP (10 req/min)')
    console.log('  POST http://localhost:3000/api/protected  - Token Bucket by X-User-Id (20 capacity)')
    console.log('  GET  http://localhost:3000/api/custom-key - Custom by X-API-Key (5 req/30s)')
    console.log('')
    console.log('Test commands:')
    console.log('  curl http://localhost:3000/')
    console.log('  curl -X POST http://localhost:3000/api/protected -H "X-User-Id: user123"')
    console.log('  curl http://localhost:3000/api/custom-key -H "X-API-Key: my-key"')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
