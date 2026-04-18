import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp(
  async (fastify, options: { prisma: PrismaClient }) => {
    fastify.decorate('prisma', options.prisma);

    fastify.addHook('onClose', async () => {
      await options.prisma.$disconnect();
    });
  },
);
