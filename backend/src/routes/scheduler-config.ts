/**
 * Scheduler Configuration API Routes
 * 
 * Endpoints for managing scheduler weights and configuration
 */

import { FastifyInstance } from 'fastify';
import { ScoreWeights } from '@edgecloud/ml-scheduler';
import { z } from 'zod';

// Validation schema for weights
const WeightsSchema = z.object({
  latency: z.number().min(0).max(1).optional(),
  cpu: z.number().min(0).max(1).optional(),
  memory: z.number().min(0).max(1).optional(),
  cost: z.number().min(0).max(1).optional(),
  network: z.number().min(0).max(1).optional(),
  ml: z.number().min(0).max(1).optional(),
  health: z.number().min(0).max(1).optional(),
});

interface SchedulerConfigRoutesOptions {
  getWeights: () => ScoreWeights;
  setWeights: (weights: Partial<ScoreWeights>) => void;
  getCircuitBreakerHealth: () => Record<string, unknown>;
}

export async function schedulerConfigRoutes(
  fastify: FastifyInstance,
  options: SchedulerConfigRoutesOptions
) {
  // Get current scheduler weights
  fastify.get('/weights', async (request, reply) => {
    const weights = options.getWeights();
    
    return reply.send({
      success: true,
      data: {
        weights,
        normalized: normalizeWeights(weights),
        updatedAt: new Date().toISOString(),
      },
    });
  });

  // Update scheduler weights
  fastify.put('/weights', {
    schema: {
      body: {
        type: 'object',
        properties: {
          latency: { type: 'number', minimum: 0, maximum: 1 },
          cpu: { type: 'number', minimum: 0, maximum: 1 },
          memory: { type: 'number', minimum: 0, maximum: 1 },
          cost: { type: 'number', minimum: 0, maximum: 1 },
          network: { type: 'number', minimum: 0, maximum: 1 },
          ml: { type: 'number', minimum: 0, maximum: 1 },
          health: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const body = WeightsSchema.parse(request.body);
    
    options.setWeights(body);
    
    const updatedWeights = options.getWeights();
    
    return reply.send({
      success: true,
      message: 'Scheduler weights updated',
      data: {
        weights: updatedWeights,
        normalized: normalizeWeights(updatedWeights),
      },
    });
  });

  // Reset weights to defaults
  fastify.post('/weights/reset', async (request, reply) => {
    const defaultWeights: ScoreWeights = {
      latency: 0.2,
      cpu: 0.15,
      memory: 0.15,
      cost: 0.2,
      network: 0.1,
      ml: 0.1,
      health: 0.1,
    };
    
    options.setWeights(defaultWeights);
    
    return reply.send({
      success: true,
      message: 'Scheduler weights reset to defaults',
      data: {
        weights: defaultWeights,
      },
    });
  });

  // Get circuit breaker health
  fastify.get('/circuit-breakers', async (request, reply) => {
    const health = options.getCircuitBreakerHealth();
    
    return reply.send({
      success: true,
      data: {
        circuitBreakers: health,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Get scheduler presets
  fastify.get('/presets', async (request, reply) => {
    return reply.send({
      success: true,
      data: {
        presets: [
          {
            name: 'balanced',
            description: 'Balanced across all factors',
            weights: {
              latency: 0.15,
              cpu: 0.15,
              memory: 0.15,
              cost: 0.15,
              network: 0.1,
              ml: 0.15,
              health: 0.15,
            },
          },
          {
            name: 'cost-optimized',
            description: 'Prioritize cost efficiency',
            weights: {
              latency: 0.1,
              cpu: 0.1,
              memory: 0.1,
              cost: 0.4,
              network: 0.05,
              ml: 0.1,
              health: 0.15,
            },
          },
          {
            name: 'latency-optimized',
            description: 'Prioritize low latency',
            weights: {
              latency: 0.4,
              cpu: 0.1,
              memory: 0.1,
              cost: 0.1,
              network: 0.15,
              ml: 0.05,
              health: 0.1,
            },
          },
          {
            name: 'ml-enhanced',
            description: 'Trust ML predictions more',
            weights: {
              latency: 0.1,
              cpu: 0.1,
              memory: 0.1,
              cost: 0.1,
              network: 0.1,
              ml: 0.4,
              health: 0.1,
            },
          },
          {
            name: 'health-priority',
            description: 'Prioritize healthy nodes',
            weights: {
              latency: 0.1,
              cpu: 0.1,
              memory: 0.1,
              cost: 0.1,
              network: 0.1,
              ml: 0.1,
              health: 0.4,
            },
          },
        ],
      },
    });
  });

  // Apply a preset
  fastify.post('/presets/:name/apply', async (request, reply) => {
    const { name } = request.params as { name: string };
    
    const presets: Record<string, ScoreWeights> = {
      'balanced': {
        latency: 0.15,
        cpu: 0.15,
        memory: 0.15,
        cost: 0.15,
        network: 0.1,
        ml: 0.15,
        health: 0.15,
      },
      'cost-optimized': {
        latency: 0.1,
        cpu: 0.1,
        memory: 0.1,
        cost: 0.4,
        network: 0.05,
        ml: 0.1,
        health: 0.15,
      },
      'latency-optimized': {
        latency: 0.4,
        cpu: 0.1,
        memory: 0.1,
        cost: 0.1,
        network: 0.15,
        ml: 0.05,
        health: 0.1,
      },
      'ml-enhanced': {
        latency: 0.1,
        cpu: 0.1,
        memory: 0.1,
        cost: 0.1,
        network: 0.1,
        ml: 0.4,
        health: 0.1,
      },
      'health-priority': {
        latency: 0.1,
        cpu: 0.1,
        memory: 0.1,
        cost: 0.1,
        network: 0.1,
        ml: 0.1,
        health: 0.4,
      },
    };
    
    const preset = presets[name];
    if (!preset) {
      return reply.status(404).send({
        success: false,
        error: `Preset '${name}' not found`,
      });
    }
    
    options.setWeights(preset);
    
    return reply.send({
      success: true,
      message: `Applied preset: ${name}`,
      data: {
        weights: preset,
      },
    });
  });
}

/**
 * Normalize weights to sum to 1
 */
function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const sum = Object.values(weights).reduce((a: number, b: number) => a + b, 0);
  
  if (sum === 0) return weights;
  
  return {
    latency: weights.latency / sum,
    cpu: weights.cpu / sum,
    memory: weights.memory / sum,
    cost: weights.cost / sum,
    network: weights.network / sum,
    ml: weights.ml / sum,
    health: weights.health / sum,
  };
}
