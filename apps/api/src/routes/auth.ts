import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AuthController } from '../controllers/auth.controller';
import { loginSchema, registerSchema, refreshTokenSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Initialize Controller with decorated services
  const controller = new AuthController(
    (fastify as any).authService,
    (fastify as any).rateLimitService,
  );

  // 2. Register new user
  fastify.post(
    '/register',
    {
      schema: {
        body: zodToFastifySchema(registerSchema),
        tags: ['auth'],
        summary: 'Register a new user',
      },
      // Note: we removed the basic rateLimit configuration here
      // as the controller handles it more robustly or we use the plugin global config
    },
    controller.register.bind(controller),
  );

  // 3. Login
  fastify.post(
    '/login',
    {
      schema: {
        body: zodToFastifySchema(loginSchema),
        tags: ['auth'],
        summary: 'Login and get tokens',
      },
    },
    controller.login.bind(controller),
  );

  // 4. Refresh token
  fastify.post(
    '/refresh',
    {
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
      preHandler: [fastify.authenticate],
    },
    controller.logout.bind(controller),
  );

  // 6. Get current user
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
    },
    async (request) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user!.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });
      return user;
    },
  );
};

export default authRoutes;
