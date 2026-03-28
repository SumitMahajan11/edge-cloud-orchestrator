// Security module exports

// Authentication
export { mtlsManager, MTLSManager } from '../auth/mtls'
export { rbacManager, RBACManager, PermissionDeniedError, ROLE_DEFINITIONS } from '../auth/rbac'
export { auditLogger, AuditLogger } from '../auth/audit'

// Security utilities
export { rateLimiter, RateLimiter, RateLimitExceededError, DEFAULT_CONFIGS } from './rate-limiter'
export { secretManager, SecretManager } from './secrets'
export { securityHeaders, SecurityHeadersManager, DEFAULT_CSP } from './headers'
export { intrusionDetection, IntrusionDetectionSystem } from './intrusion-detection'

// Validation
export {
  InputValidator,
  InputSanitizer,
  SchemaValidator,
  schemaValidator,
  TaskSubmissionSchema,
  NodeRegistrationSchema,
  WebhookConfigSchema,
} from './validation'

// Types
export type { Certificate, MTLSConfig } from '../auth/mtls'
export type { Role, Resource, Action, Permission, RoleDefinition, UserSession } from '../auth/rbac'
export type { AuditEvent, AuditEventType, AuditSeverity, AuditFilter } from '../auth/audit'
export type { RateLimitConfig, RateLimitEntry, RateLimitResult } from './rate-limiter'
export type { Secret, SecretConfig } from './secrets'
export type { SecurityHeaders } from './headers'
export type { SecurityEvent, DetectionRule, Alert, IDSStats } from './intrusion-detection'
export type { ValidatorFn, ValidationSchema, ValidationResult } from './validation'
