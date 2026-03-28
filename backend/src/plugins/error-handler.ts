import fp from 'fastify-plugin'
import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

interface AppError extends Error {
  statusCode?: number
  code?: string
}

export const errorHandler = fp(async (fastify: FastifyInstance) => {
  fastify.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    // Log error
    request.log.error({
      error: {
        message: error.message,
        stack: error.stack,
        statusCode: error.statusCode,
      },
      request: {
        method: request.method,
        url: request.url,
        headers: request.headers,
      },
    })
    
    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code,
        })),
      })
    }
    
    // Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          return reply.status(409).send({
            error: 'Conflict',
            message: 'A record with this value already exists',
            field: error.meta?.target,
          })
        case 'P2025':
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Record not found',
          })
        default:
          return reply.status(500).send({
            error: 'Database Error',
            code: error.code,
          })
      }
    }
    
    // JWT errors
    if (error.message?.includes('jwt') || error.message?.includes('token')) {
      return reply.status(401).send({
        error: 'Authentication Error',
        message: 'Invalid or expired token',
      })
    }
    
    // Rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
      })
    }
    
    // Default error
    const statusCode = error.statusCode || 500
    return reply.status(statusCode).send({
      error: error.name || 'Internal Server Error',
      message: statusCode === 500 ? 'An unexpected error occurred' : error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    })
  })
})
