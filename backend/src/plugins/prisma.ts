import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

export const prismaPlugin = fp(async (fastify, options: { prisma: PrismaClient }) => {
  fastify.decorate('prisma', options.prisma)
  
  fastify.addHook('onClose', async () => {
    await options.prisma.$disconnect()
  })
})
