/**
 * Global Request ID Middleware
 * 
 * Tracing backbone for distributed requests.
 * Flows through: API → Kafka → DB → WebSocket
 */

import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import type { Logger } from 'pino';

// ============================================================================
// Types
// ============================================================================

export interface RequestContext {
  requestId: string;
  traceId: string;
  spanId: string;
  parentId?: string;
  userId?: string;
  tenantId?: string;
  source: string;
  startTime: number;
  metadata: Record<string, unknown>;
}

export interface TracingHeaders {
  'x-request-id': string;
  'x-trace-id': string;
  'x-span-id': string;
  'x-parent-id'?: string;
  'x-user-id'?: string;
  'x-tenant-id'?: string;
  'x-source': string;
}

// ============================================================================
// Constants
// ============================================================================

export const TRACING_HEADERS: (keyof TracingHeaders)[] = [
  'x-request-id',
  'x-trace-id',
  'x-span-id',
  'x-parent-id',
  'x-user-id',
  'x-tenant-id',
  'x-source',
];

// Async local storage for request context
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// ============================================================================
// Request ID Middleware
// ============================================================================

export function createRequestIdMiddleware(logger: Logger) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();

    // Extract or generate IDs
    const requestId = request.headers['x-request-id'] as string || generateId('req');
    const traceId = request.headers['x-trace-id'] as string || generateId('trace');
    const spanId = generateId('span');
    const parentId = request.headers['x-span-id'] as string;
    const userId = request.headers['x-user-id'] as string;
    const tenantId = request.headers['x-tenant-id'] as string;
    const source = request.headers['x-source'] as string || 'api-gateway';

    const context: RequestContext = {
      requestId,
      traceId,
      spanId,
      parentId,
      userId,
      tenantId,
      source,
      startTime,
      metadata: {},
    };

    // Store in async local storage
    asyncLocalStorage.run(context, () => {});

    // Set response headers
    reply.header('x-request-id', requestId);
    reply.header('x-trace-id', traceId);
    reply.header('x-span-id', spanId);
    reply.header('x-source', source);

    // Add to request object for easy access
    request.requestContext = context;

    // Log request start
    logger.info({
      requestId,
      traceId,
      method: request.method,
      url: request.url,
      userId,
      tenantId,
    }, 'Request started');

    // Hook to log request completion
    request.raw.on('end', () => {
      const duration = Date.now() - startTime;
      logger.info({
        requestId,
        traceId,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
      }, 'Request completed');
    });
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${uuidv4().split('-')[0]}${Date.now().toString(36)}`;
}

/**
 * Get current request context from async storage
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get request ID for current context
 */
export function getRequestId(): string {
  return asyncLocalStorage.getStore()?.requestId || 'unknown';
}

/**
 * Get trace ID for current context
 */
export function getTraceId(): string {
  return asyncLocalStorage.getStore()?.traceId || 'unknown';
}

/**
 * Create a child span for tracing
 */
export function createChildSpan(name: string): RequestContext {
  const parent = asyncLocalStorage.getStore();
  
  const child: RequestContext = {
    requestId: parent?.requestId || generateId('req'),
    traceId: parent?.traceId || generateId('trace'),
    spanId: generateId('span'),
    parentId: parent?.spanId,
    userId: parent?.userId,
    tenantId: parent?.tenantId,
    source: parent?.source || 'unknown',
    startTime: Date.now(),
    metadata: { spanName: name, ...parent?.metadata },
  };

  return child;
}

/**
 * Run code with a specific context
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Inject tracing headers into outgoing requests
 */
export function injectTracingHeaders(headers: Record<string, string> = {}): TracingHeaders {
  const context = asyncLocalStorage.getStore();
  
  return {
    'x-request-id': context?.requestId || generateId('req'),
    'x-trace-id': context?.traceId || generateId('trace'),
    'x-span-id': generateId('span'),
    'x-parent-id': context?.spanId,
    'x-user-id': context?.userId,
    'x-tenant-id': context?.tenantId,
    'x-source': context?.source || 'service',
    ...headers,
  };
}

/**
 * Extract tracing headers from incoming message/event
 */
export function extractTracingHeaders(headers: Record<string, string | undefined>): Partial<RequestContext> {
  return {
    requestId: headers['x-request-id'],
    traceId: headers['x-trace-id'],
    spanId: headers['x-span-id'],
    parentId: headers['x-parent-id'],
    userId: headers['x-user-id'],
    tenantId: headers['x-tenant-id'],
    source: headers['x-source'],
  };
}

/**
 * Create Kafka message headers with tracing
 */
export function createKafkaTracingHeaders(): Record<string, string> {
  const context = asyncLocalStorage.getStore();
  
  return {
    'x-request-id': context?.requestId || generateId('req'),
    'x-trace-id': context?.traceId || generateId('trace'),
    'x-span-id': generateId('span'),
    'x-parent-id': context?.spanId || '',
    'x-source': context?.source || 'kafka-producer',
    'timestamp': Date.now().toString(),
  };
}

/**
 * Create WebSocket message with tracing
 */
export function createWebSocketTracingMetadata(): Record<string, unknown> {
  const context = asyncLocalStorage.getStore();
  
  return {
    requestId: context?.requestId,
    traceId: context?.traceId,
    spanId: generateId('span'),
    parentId: context?.spanId,
    source: 'websocket',
    timestamp: Date.now(),
  };
}

/**
 * Add metadata to current context
 */
export function addContextMetadata(key: string, value: unknown): void {
  const context = asyncLocalStorage.getStore();
  if (context) {
    context.metadata[key] = value;
  }
}

// ============================================================================
// Type Augmentation
// ============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    requestContext?: RequestContext;
  }
}
