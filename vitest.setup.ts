import 'reflect-metadata'
import { vi } from 'vitest'

// Mock Opentelemetry and Trace APIs to avoid binary/resolution issues in monorepo tests
vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    trace: {
      getSpan: vi.fn(),
      getTracer: vi.fn().mockReturnValue({
        startSpan: vi.fn().mockReturnValue({
          end: vi.fn(),
          spanContext: vi.fn().mockReturnValue({ traceId: '1', spanId: '1' }),
          setStatus: vi.fn(),
          setAttribute: vi.fn(),
        }),
      }),
    },
    context: {
      active: vi.fn(),
    },
    propagation: {
      inject: vi.fn(),
      extract: vi.fn(),
    },
  };
})

// Mock fastify-plugin which often fails in Vite/CJS environments
vi.mock('fastify-plugin', () => ({
  default: (fn: any) => fn,
}))

// Mock pino-pretty
vi.mock('pino-pretty', () => ({
  default: () => ({}),
}))

// Mock observability package to prevent deep transitive dependency failures
vi.mock('@edgecloud/observability', () => ({
  initTracing: vi.fn(),
  MetricsCollector: vi.fn().mockImplementation(() => ({
    recordMLFallback: vi.fn(),
    recordSchedulingDecision: vi.fn(),
    incrementCounter: vi.fn(),
    recordGauge: vi.fn(),
    recordMetric: vi.fn(),
  })),
  createTracer: vi.fn().mockReturnValue({
    startActiveSpan: vi.fn((name, fn) => fn({ end: vi.fn() })),
  }),
}))

process.env.NODE_ENV = process.env.NODE_ENV || 'test'
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'fatal'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(32)
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'b'.repeat(32)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db?sslmode=require'
process.env.FORCE_MOCK_REDIS = process.env.FORCE_MOCK_REDIS || 'true'
process.env.FORCE_MOCK_DB = process.env.FORCE_MOCK_DB || 'true'
process.env.ALLOW_PRIVATE_IPS = process.env.ALLOW_PRIVATE_IPS || 'true'
