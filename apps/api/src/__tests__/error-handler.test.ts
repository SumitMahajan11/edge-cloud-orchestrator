import Fastify from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import errorHandler from '../plugins/error-handler';
import type { ApiError } from '@edgecloud/shared-kernel';
import { env } from '../config/env';

describe('Global Error Handler', () => {
  const app = Fastify();

  beforeAll(async () => {
    // Register the error handler
    // We call it directly on the app instance because fastify-plugin is mocked in vitest.setup.ts,
    // which would otherwise prevent the error handler from being global.
    await (errorHandler as any)(app, {}, () => {});

    // Register test routes that throw specific errors
    app.get('/error/zod', async () => {
      const schema = z.object({ name: z.string() });
      schema.parse({}); // Throws ZodError
    });

    app.get('/error/prisma-notfound', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
    });

    app.get('/error/prisma-conflict', async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['email'] },
        },
      );
    });

    app.get('/error/jwt-expired', async () => {
      throw new Error('jwt expired');
    });

    app.get('/error/jwt-invalid', async () => {
      throw new Error('invalid token');
    });

    app.get('/error/forbidden', async () => {
      throw new Error('Insufficient permissions');
    });

    app.get('/error/rate-limit', async () => {
      const err: any = new Error('Rate limit exceeded');
      err.statusCode = 429;
      throw err;
    });

    app.get('/error/unknown', async () => {
      throw new Error('Something went wrong');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should format Zod validation errors (400)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/zod',
    });

    expect(response.statusCode).toBe(400);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Validation failed');
    expect(body.details).toBeDefined();
    expect(body.requestId).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  it('should format Prisma P2025 as RESOURCE_NOT_FOUND (404)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/prisma-notfound',
    });

    expect(response.statusCode).toBe(404);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('The requested resource was not found');
  });

  it('should format Prisma P2002 as RESOURCE_CONFLICT (409)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/prisma-conflict',
    });

    expect(response.statusCode).toBe(409);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('RESOURCE_CONFLICT');
    expect(body.details).toMatchObject({ target: ['email'] });
  });

  it('should format expired JWT as TOKEN_EXPIRED (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/jwt-expired',
    });

    expect(response.statusCode).toBe(401);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  it('should format invalid JWT as TOKEN_INVALID (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/jwt-invalid',
    });

    expect(response.statusCode).toBe(401);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('TOKEN_INVALID');
  });

  it('should format permission errors as FORBIDDEN (403)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/forbidden',
    });

    expect(response.statusCode).toBe(403);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('should format rate limit hits as RATE_LIMIT_EXCEEDED (429)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/rate-limit',
    });

    expect(response.statusCode).toBe(429);
    console.log('PAYLOAD:', response.payload);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should format unknown errors as INTERNAL_ERROR (500)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error/unknown',
    });

    expect(response.statusCode).toBe(500);
    const { error: body } = JSON.parse(response.payload) as { error: ApiError };
    expect(body.code).toBe('INTERNAL_ERROR');

    // In test environment, stack should be included
    expect(body.stack).toBeDefined();
  });

  it('should hide stack trace in production', async () => {
    const originalEnv = env.NODE_ENV;
    (env as any).NODE_ENV = 'production';

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/error/unknown',
      });

      expect(response.statusCode).toBe(500);
      const { error: body } = JSON.parse(response.payload) as {
        error: ApiError;
      };
      expect(body.stack).toBeUndefined();
      expect(body.message).toBe('An internal server error occurred');
    } finally {
      (env as any).NODE_ENV = originalEnv;
    }
  });
});
