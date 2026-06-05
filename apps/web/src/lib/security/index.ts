// Security module exports

// Authentication
export { AuditLogger, auditLogger } from "../auth/audit";
export { MTLSManager, mtlsManager } from "../auth/mtls";
export {
  PermissionDeniedError,
  RBACManager,
  rbacManager,
  ROLE_DEFINITIONS,
} from "../auth/rbac";

// Security utilities
export {
  DEFAULT_CSP,
  securityHeaders,
  SecurityHeadersManager,
} from "./headers";
export {
  intrusionDetection,
  IntrusionDetectionSystem,
} from "./intrusion-detection";
export {
  DEFAULT_CONFIGS,
  RateLimiter,
  rateLimiter,
  RateLimitExceededError,
} from "./rate-limiter";
export { SecretManager, secretManager } from "./secrets";

// Validation
export {
  InputSanitizer,
  InputValidator,
  NodeRegistrationSchema,
  SchemaValidator,
  schemaValidator,
  TaskSubmissionSchema,
  WebhookConfigSchema,
} from "./validation";

// Types
export type {
  AuditEvent,
  AuditEventType,
  AuditFilter,
  AuditSeverity,
} from "../auth/audit";
export type { Certificate, MTLSConfig } from "../auth/mtls";
export type {
  Action,
  Permission,
  Resource,
  Role,
  RoleDefinition,
  UserSession,
} from "../auth/rbac";
export type { SecurityHeaders } from "./headers";
export type {
  Alert,
  DetectionRule,
  IDSStats,
  SecurityEvent,
} from "./intrusion-detection";
export type {
  RateLimitConfig,
  RateLimitEntry,
  RateLimitResult,
} from "./rate-limiter";
export type { Secret, SecretConfig } from "./secrets";
export type {
  ValidationResult,
  ValidationSchema,
  ValidatorFn,
} from "./validation";
