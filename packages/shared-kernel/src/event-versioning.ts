/**
 * Event Versioning System
 * 
 * Ensures backward compatibility for Kafka events.
 * Supports:
 * - Event versioning
 * - Schema evolution
 * - Version-based routing
 */

import type { Logger } from 'pino';

// ============================================================================
// Types
// ============================================================================

export interface VersionedEvent {
  eventId: string;
  eventType: string;
  version: string;
  timestamp: Date;
  source: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface EventSchema {
  version: string;
  eventType: string;
  schema: Record<string, unknown>;
  upconvertFrom?: string;
  upconverter?: (oldEvent: VersionedEvent) => VersionedEvent;
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface VersionRegistry {
  [eventType: string]: {
    currentVersion: string;
    supportedVersions: string[];
    schemas: Record<string, EventSchema>;
  };
}

// ============================================================================
// Event Version Constants
// ============================================================================

export const EVENT_VERSIONS = {
  TASK_CREATED: { current: 'v2', supported: ['v1', 'v2'] },
  TASK_SCHEDULED: { current: 'v2', supported: ['v1', 'v2'] },
  TASK_COMPLETED: { current: 'v2', supported: ['v1', 'v2'] },
  TASK_FAILED: { current: 'v2', supported: ['v1', 'v2'] },
  NODE_REGISTERED: { current: 'v1', supported: ['v1'] },
  NODE_HEARTBEAT: { current: 'v2', supported: ['v1', 'v2'] },
  NODE_STATUS_CHANGED: { current: 'v1', supported: ['v1'] },
  SAGA_STARTED: { current: 'v1', supported: ['v1'] },
  SAGA_STEP_COMPLETED: { current: 'v1', supported: ['v1'] },
  SAGA_COMPENSATED: { current: 'v1', supported: ['v1'] },
} as const;

// ============================================================================
// EventVersioningService
// ============================================================================

export class EventVersioningService {
  private logger: Logger;
  private registry: VersionRegistry = {};

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializeRegistry();
  }

  /**
   * Initialize version registry with schemas
   */
  private initializeRegistry(): void {
    // Task Created
    this.registerSchema({
      version: 'v1',
      eventType: 'TaskCreated',
      schema: {
        taskId: 'string',
        name: 'string',
        type: 'string',
        priority: 'string',
      },
    });

    this.registerSchema({
      version: 'v2',
      eventType: 'TaskCreated',
      schema: {
        taskId: 'string',
        name: 'string',
        type: 'string',
        priority: 'string',
        requirements: 'object?', // Added in v2
        deadline: 'string?', // Added in v2
      },
      upconvertFrom: 'v1',
      upconverter: (oldEvent) => ({
        ...oldEvent,
        payload: {
          ...oldEvent.payload,
          requirements: {},
          deadline: null,
        },
      }),
    });

    // Task Completed
    this.registerSchema({
      version: 'v1',
      eventType: 'TaskCompleted',
      schema: {
        taskId: 'string',
        nodeId: 'string',
        output: 'object?',
      },
    });

    this.registerSchema({
      version: 'v2',
      eventType: 'TaskCompleted',
      schema: {
        taskId: 'string',
        nodeId: 'string',
        output: 'object?',
        duration: 'number?', // Added in v2
        cost: 'number?', // Added in v2
        metrics: 'object?', // Added in v2
      },
      upconvertFrom: 'v1',
      upconverter: (oldEvent) => ({
        ...oldEvent,
        payload: {
          ...oldEvent.payload,
          duration: null,
          cost: null,
          metrics: null,
        },
      }),
    });

    // Node Heartbeat
    this.registerSchema({
      version: 'v1',
      eventType: 'NodeHeartbeat',
      schema: {
        nodeId: 'string',
        status: 'string',
        cpuUsage: 'number',
        memoryUsage: 'number',
      },
    });

    this.registerSchema({
      version: 'v2',
      eventType: 'NodeHeartbeat',
      schema: {
        nodeId: 'string',
        status: 'string',
        metrics: { // Nested metrics in v2
          cpu: 'number',
          memory: 'number',
          disk: 'number?',
          network: 'object?',
        },
        tasks: {
          running: 'number',
          queued: 'number?',
        },
      },
      upconvertFrom: 'v1',
      upconverter: (oldEvent) => ({
        ...oldEvent,
        payload: {
          nodeId: oldEvent.payload.nodeId,
          status: oldEvent.payload.status,
          metrics: {
            cpu: oldEvent.payload.cpuUsage,
            memory: oldEvent.payload.memoryUsage,
          },
          tasks: {
            running: 0,
          },
        },
      }),
    });
  }

  /**
   * Register an event schema
   */
  registerSchema(schema: EventSchema): void {
    if (!this.registry[schema.eventType]) {
      this.registry[schema.eventType] = {
        currentVersion: schema.version,
        supportedVersions: [schema.version],
        schemas: {},
      };
    }

    this.registry[schema.eventType].schemas[schema.version] = schema;
    this.registry[schema.eventType].supportedVersions.push(schema.version);

    // Update current version if newer
    if (this.compareVersions(schema.version, this.registry[schema.eventType].currentVersion) > 0) {
      this.registry[schema.eventType].currentVersion = schema.version;
    }
  }

  /**
   * Create a versioned event
   */
  createEvent(
    eventType: string,
    payload: Record<string, unknown>,
    source: string,
    metadata?: Record<string, unknown>
  ): VersionedEvent {
    const registration = this.registry[eventType];
    if (!registration) {
      this.logger.warn({ eventType }, 'Unknown event type, using v1');
    }

    const version = registration?.currentVersion || 'v1';

    return {
      eventId: this.generateEventId(),
      eventType,
      version,
      timestamp: new Date(),
      source,
      payload,
      metadata,
    };
  }

  /**
   * Validate an event against its schema
   */
  validateEvent(event: VersionedEvent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const registration = this.registry[event.eventType];

    if (!registration) {
      return { valid: true, errors: [] }; // Unknown events pass
    }

    const schema = registration.schemas[event.version];
    if (!schema) {
      errors.push(`Unsupported version: ${event.version}`);
      return { valid: false, errors };
    }

    if (schema.deprecated) {
      this.logger.warn(
        { eventType: event.eventType, version: event.version },
        `Deprecated event: ${schema.deprecationMessage}`
      );
    }

    // Basic validation (in production, use JSON Schema validator)
    for (const [field, type] of Object.entries(schema.schema)) {
      const typeStr = String(type);
      const isOptional = typeStr.endsWith('?');
      const actualType = typeStr.replace('?', '');

      if (!(field in event.payload)) {
        if (!isOptional) {
          errors.push(`Missing required field: ${field}`);
        }
        continue;
      }

      const value = event.payload[field];
      if (value !== null && value !== undefined) {
        const actualTypeName = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== actualTypeName && actualType !== 'object') {
          errors.push(`Field ${field} has wrong type: expected ${actualType}, got ${actualTypeName}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Convert event to a specific version
   */
  convertToVersion(event: VersionedEvent, targetVersion: string): VersionedEvent {
    if (event.version === targetVersion) {
      return event;
    }

    const registration = this.registry[event.eventType];
    if (!registration) {
      return event;
    }

    // Find conversion path
    const sourceSchema = registration.schemas[event.version];
    const targetSchema = registration.schemas[targetVersion];

    if (!sourceSchema || !targetSchema) {
      throw new Error(`Cannot convert from ${event.version} to ${targetVersion}`);
    }

    // Apply upconverters
    let converted = event;
    let currentVersion = event.version;

    while (currentVersion !== targetVersion) {
      const schema = registration.schemas[currentVersion];
      if (!schema || !schema.upconvertFrom) {
        throw new Error(`No upconverter from ${currentVersion}`);
      }

      converted = schema.upconverter!(converted);
      currentVersion = Object.keys(registration.schemas).find(
        v => registration.schemas[v].upconvertFrom === currentVersion
      ) || targetVersion;
    }

    return converted;
  }

  /**
   * Check if version is supported
   */
  isVersionSupported(eventType: string, version: string): boolean {
    const registration = this.registry[eventType];
    return registration?.supportedVersions.includes(version) ?? true;
  }

  /**
   * Get current version for event type
   */
  getCurrentVersion(eventType: string): string {
    return this.registry[eventType]?.currentVersion || 'v1';
  }

  // Private helpers

  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private compareVersions(a: string, b: string): number {
    const numA = parseInt(a.replace('v', ''), 10);
    const numB = parseInt(b.replace('v', ''), 10);
    return numA - numB;
  }
}
