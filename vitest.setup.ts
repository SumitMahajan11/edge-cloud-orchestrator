import { vi } from 'vitest'

// Mock Opentelemetry and Trace APIs to avoid binary/resolution issues in monorepo tests
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getSpan: vi.fn(),
    getTracer: vi.fn().mockReturnValue({
      startSpan: vi.fn().mockReturnValue({
        end: vi.fn(),
        spanContext: vi.fn().mockReturnValue({ traceId: '1', spanId: '1' }),
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
}))

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
  MetricsCollector: vi.fn().mockImplementation(() => ({
    recordMLFallback: vi.fn(),
    recordSchedulingDecision: vi.fn(),
    incrementCounter: vi.fn(),
    recordGauge: vi.fn(),
  })),
  createTracer: vi.fn().mockReturnValue({
    startActiveSpan: vi.fn((name, fn) => fn({ end: vi.fn() })),
  }),
}))

process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
