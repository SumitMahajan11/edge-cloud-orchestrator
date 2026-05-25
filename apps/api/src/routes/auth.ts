import { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { AuthController } from '../controllers/auth.controller';
import { idParamSchema,loginSchema, refreshTokenSchema,registerSchema  } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Initialize Controller with decorated services
  const controller = new AuthController(
    fastify.authService,
    fastify.rateLimitService,
  );

  // 2. Register new user
  fastify.post(
    '/register',
    {
      config: { public: true },
      schema: {
        body: zodToFastifySchema(registerSchema),
        tags: ['auth'],
        summary: 'Register a new user',
        response: {
          400: { $ref: 'ErrorSchema#' },
          409: { $ref: 'ErrorSchema#' },
        },
      },
    },
    controller.register.bind(controller),
  );

  // 3. Login
  fastify.post(
    '/login',
    {
      config: { public: true },
      schema: {
        body: zodToFastifySchema(loginSchema),
        tags: ['auth'],
        summary: 'Login and get tokens',
        response: {
          401: { $ref: 'ErrorSchema' },
          429: { $ref: 'ErrorSchema' },
        },
      },
    },
    controller.login.bind(controller),
  );

  // 4. Refresh token
  fastify.post(
    '/refresh',
    {
      config: { public: true },
      schema: {
        body: zodToFastifySchema(refreshTokenSchema),
        tags: ['auth'],
        summary: 'Refresh access token',
      },
    },
    controller.refresh.bind(controller),
  );

  // 5. Logout
  fastify.post(
    '/logout',
    {
      preHandler: [async (req, reply) => { 
        if (typeof fastify.authenticate !== 'function') {
          throw new Error('fastify.authenticate is not a function. Auth plugin might not be registered correctly.');
        }
        return fastify.authenticate(req, reply); 
      }],
      schema: {

        tags: ['auth'],
        summary: 'Logout and invalidate session',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
    controller.logout.bind(controller),
  );

  // 6. Get current user
  fastify.get(
    '/me',
    {
      preHandler: [async (req, reply) => { 
        if (typeof fastify.authenticate !== 'function') {
          throw new Error('fastify.authenticate is not a function. Auth plugin might not be registered correctly.');
        }
        return fastify.authenticate(req, reply); 
      }],

      schema: {
        tags: ['auth'],
        summary: 'Get current user profile',
      },
    },
    controller.me.bind(controller),
  );

  // 7. Session management
  fastify.get(
    '/sessions',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'List active user sessions',
      },
    },
    controller.listSessions.bind(controller),
  );

  fastify.delete(
    '/sessions/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['auth'],
        summary: 'Revoke a specific session',
      },
    },
    controller.revokeSession.bind(controller),
  );

  fastify.delete(
    '/sessions',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke all user sessions (logout everywhere)',
      },
    },
    controller.revokeAllSessions.bind(controller),
  );
};

export default authRoutes;

