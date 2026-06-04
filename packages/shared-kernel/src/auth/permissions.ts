export const Permissions = {
  // Task permissions
  TASK_READ: 'task:read',
  TASK_CREATE: 'task:create',
  TASK_CANCEL: 'task:cancel',
  TASK_ADMIN: 'task:admin',           // retry, force-complete
  
  // Node permissions
  NODE_READ: 'node:read',
  NODE_REGISTER: 'node:register',
  NODE_DRAIN: 'node:drain',           
  NODE_FORCE_OFFLINE: 'node:force_offline',
  NODE_ADMIN: 'node:admin',
  
  // ML permissions
  ML_READ: 'ml:read',
  ML_RETRAIN: 'ml:retrain',           
  ML_DEPLOY: 'ml:deploy',
  ML_ADMIN: 'ml:admin',
  
  // Alert permissions
  ALERT_READ: 'alert:read',
  ALERT_MANAGE: 'alert:manage',
  
  // Cost permissions
  COST_READ: 'cost:read',
  COST_MANAGE: 'cost:manage',
  
  // Scheduler permissions
  SCHEDULER_READ: 'scheduler:read',
  SCHEDULER_MANAGE: 'scheduler:manage',
  
  // Webhook permissions
  WEBHOOK_READ: 'webhook:read',
  WEBHOOK_MANAGE: 'webhook:manage',
  
  // API Key permissions
  API_KEY_MANAGE: 'api_key:manage',
  
  // System permissions (super admin only)
  SYSTEM_READ: 'system:read',
  AUDIT_READ: 'system:audit_read',
  CIRCUIT_BREAKER_RESET: 'system:circuit_breaker_reset',
  EVENT_REPUBLISH: 'system:event_republish',
  TENANT_MANAGE: 'system:tenant_manage',
  CARBON_READ: 'system:carbon_read',
  CARBON_POLICY_WRITE: 'system:carbon_policy_write',
} as const;

export type Permission = typeof Permissions[keyof typeof Permissions];

// Mapping roles to permissions
// We support both the new role names and legacy role names for compatibility during migration
export const RolePermissions: Record<string, Permission[]> = {
  // New role names
  USER: [
    Permissions.TASK_READ, Permissions.TASK_CREATE, Permissions.TASK_CANCEL,
    Permissions.NODE_READ, Permissions.ML_READ,
    Permissions.CARBON_READ,
    Permissions.API_KEY_MANAGE,
    Permissions.ALERT_READ,
    Permissions.COST_READ,
    Permissions.SCHEDULER_READ,
    Permissions.WEBHOOK_READ,
  ],
  TENANT_ADMIN: [
    Permissions.TASK_READ, Permissions.TASK_CREATE, Permissions.TASK_CANCEL,
    Permissions.NODE_READ, Permissions.ML_READ,
    Permissions.TASK_ADMIN, Permissions.NODE_REGISTER,
    Permissions.NODE_DRAIN, Permissions.ML_RETRAIN,
    Permissions.CARBON_READ,
    Permissions.CARBON_POLICY_WRITE,
    Permissions.AUDIT_READ,
    Permissions.API_KEY_MANAGE,
    Permissions.ALERT_READ,
    Permissions.ALERT_MANAGE,
    Permissions.COST_READ,
    Permissions.COST_MANAGE,
    Permissions.SCHEDULER_READ,
    Permissions.SCHEDULER_MANAGE,
    Permissions.WEBHOOK_READ,
    Permissions.WEBHOOK_MANAGE,
  ],
  SUPER_ADMIN: [
    ...Object.values(Permissions) as Permission[],
  ],
  
  // Legacy role names mapping
  VIEWER: [
    Permissions.TASK_READ, Permissions.NODE_READ, Permissions.ML_READ,
    Permissions.CARBON_READ,
    Permissions.API_KEY_MANAGE,
    Permissions.ALERT_READ,
    Permissions.COST_READ,
    Permissions.SCHEDULER_READ,
    Permissions.WEBHOOK_READ,
  ],
  OPERATOR: [
    Permissions.TASK_READ, Permissions.TASK_CREATE, Permissions.TASK_CANCEL,
    Permissions.NODE_READ, Permissions.ML_READ,
    Permissions.TASK_ADMIN, Permissions.NODE_REGISTER,
    Permissions.NODE_DRAIN, Permissions.ML_RETRAIN,
    Permissions.CARBON_READ,
    Permissions.AUDIT_READ,
    Permissions.API_KEY_MANAGE,
    Permissions.ALERT_READ,
    Permissions.ALERT_MANAGE,
    Permissions.COST_READ,
    Permissions.COST_MANAGE,
    Permissions.SCHEDULER_READ,
    Permissions.SCHEDULER_MANAGE,
    Permissions.WEBHOOK_READ,
    Permissions.WEBHOOK_MANAGE,
  ],
  ADMIN: [
    ...Object.values(Permissions) as Permission[],
  ],
};
