import { EventEmitter } from 'eventemitter3';

// ABAC - Attribute-Based Access Control

export interface Subject {
  id: string;
  type: 'user' | 'service' | 'agent';
  attributes: Record<string, any>;
  roles: string[];
}

export interface Resource {
  id: string;
  type: string;
  attributes: Record<string, any>;
}

export interface Action {
  name: string;
  attributes: Record<string, any>;
}

export interface Environment {
  time: Date;
  ip?: string;
  region?: string;
  source?: string;
  [key: string]: any;
}

export interface AccessRequest {
  subject: Subject;
  resource: Resource;
  action: Action;
  environment: Environment;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  effect: 'allow' | 'deny';
  subjects: PolicyCondition[];
  resources: PolicyCondition[];
  actions: PolicyCondition[];
  environments: PolicyCondition[];
  obligations?: Obligation[];
  priority: number;
}

export interface PolicyCondition {
  type: 'equals' | 'notEquals' | 'in' | 'notIn' | 'contains' | 'notContains' | 'greaterThan' | 'lessThan' | 'regex' | 'exists';
  attribute: string;
  value: any;
}

export interface Obligation {
  type: string;
  params: Record<string, any>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedPolicies: string[];
  obligations: Obligation[];
  evaluatedAt: Date;
}

export class ABACEngine extends EventEmitter {
  private policies: Map<string, Policy> = new Map();
  private attributeResolvers: Map<string, AttributeResolver> = new Map();

  constructor() {
    super();
  }

  addPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
    this.emit('policyAdded', { policyId: policy.id, name: policy.name });
  }

  removePolicy(policyId: string): void {
    this.policies.delete(policyId);
    this.emit('policyRemoved', { policyId });
  }

  registerAttributeResolver(name: string, resolver: AttributeResolver): void {
    this.attributeResolvers.set(name, resolver);
  }

  async evaluate(request: AccessRequest): Promise<AccessDecision> {
    const matchedPolicies: string[] = [];
    const obligations: Obligation[] = [];
    let finalDecision: 'allow' | 'deny' | null = null;
    let decisionReason = 'No matching policies';

    // Resolve any dynamic attributes
    await this.resolveAttributes(request);

    // Sort policies by priority (higher priority first)
    const sortedPolicies = Array.from(this.policies.values())
      .sort((a, b) => b.priority - a.priority);

    for (const policy of sortedPolicies) {
      const matches = await this.policyMatches(policy, request);

      if (matches) {
        matchedPolicies.push(policy.id);

        if (policy.obligations) {
          obligations.push(...policy.obligations);
        }

        // First matching policy determines the decision (deny takes precedence)
        if (finalDecision === null || policy.effect === 'deny') {
          finalDecision = policy.effect;
          decisionReason = `Matched policy: ${policy.name}`;
        }

        // If we hit a deny, stop evaluating
        if (policy.effect === 'deny') {
          break;
        }
      }
    }

    const allowed = finalDecision === 'allow';

    this.emit('accessEvaluated', {
      allowed,
      subjectId: request.subject.id,
      resourceType: request.resource.type,
      action: request.action.name,
      matchedPolicies,
    });

    return {
      allowed,
      reason: decisionReason,
      matchedPolicies,
      obligations,
      evaluatedAt: new Date(),
    };
  }

  private async resolveAttributes(request: AccessRequest): Promise<void> {
    for (const [name, resolver] of this.attributeResolvers) {
      try {
        const value = await resolver.resolve(request);
        if (value !== undefined) {
          request.subject.attributes[name] = value;
        }
      } catch (error) {
        this.emit('attributeResolutionError', { name, error });
      }
    }
  }

  private async policyMatches(policy: Policy, request: AccessRequest): Promise<boolean> {
    return (
      this.conditionsMatch(policy.subjects, request.subject.attributes, request) &&
      this.conditionsMatch(policy.resources, request.resource.attributes, request) &&
      this.conditionsMatch(policy.actions, request.action.attributes, request) &&
      this.conditionsMatch(policy.environments, request.environment as Record<string, any>, request)
    );
  }

  private conditionsMatch(
    conditions: PolicyCondition[],
    attributes: Record<string, any>,
    request: AccessRequest
  ): boolean {
    if (conditions.length === 0) {
      return true;
    }

    return conditions.every(condition => this.conditionMatches(condition, attributes, request));
  }

  private conditionMatches(
    condition: PolicyCondition,
    attributes: Record<string, any>,
    request: AccessRequest
  ): boolean {
    const attributeValue = this.getNestedAttribute(attributes, condition.attribute);

    switch (condition.type) {
      case 'equals':
        return attributeValue === condition.value;

      case 'notEquals':
        return attributeValue !== condition.value;

      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(attributeValue);

      case 'notIn':
        return Array.isArray(condition.value) && !condition.value.includes(attributeValue);

      case 'contains':
        return Array.isArray(attributeValue) && attributeValue.includes(condition.value);

      case 'greaterThan':
        return typeof attributeValue === 'number' && attributeValue > condition.value;

      case 'lessThan':
        return typeof attributeValue === 'number' && attributeValue < condition.value;

      case 'regex':
        return new RegExp(condition.value).test(String(attributeValue));

      case 'exists':
        return attributeValue !== undefined && attributeValue !== null;

      default:
        return false;
    }
  }

  private getNestedAttribute(obj: Record<string, any>, path: string): any {
    return path.split('.').reduce((o, p) => o?.[p], obj);
  }

  getPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }
}

export interface AttributeResolver {
  resolve(request: AccessRequest): Promise<any>;
}

// Common attribute resolvers
export class TimeBasedAttributeResolver implements AttributeResolver {
  async resolve(request: AccessRequest): Promise<any> {
    const hour = request.environment.time.getHours();
    const dayOfWeek = request.environment.time.getDay();

    return {
      isBusinessHours: hour >= 9 && hour < 17 && dayOfWeek > 0 && dayOfWeek < 6,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      hourOfDay: hour,
      dayOfWeek,
    };
  }
}

export class RoleHierarchyResolver implements AttributeResolver {
  private roleHierarchy: Map<string, string[]> = new Map([
    ['admin', ['user', 'viewer', 'operator']],
    ['operator', ['user', 'viewer']],
    ['user', ['viewer']],
    ['viewer', []],
  ]);

  async resolve(request: AccessRequest): Promise<any> {
    const roles = request.subject.roles || [];
    const effectiveRoles = new Set<string>();

    for (const role of roles) {
      effectiveRoles.add(role);
      const inherited = this.roleHierarchy.get(role) || [];
      inherited.forEach(r => effectiveRoles.add(r));
    }

    return {
      effectiveRoles: Array.from(effectiveRoles),
      hasAdminRole: effectiveRoles.has('admin'),
      hasOperatorRole: effectiveRoles.has('operator'),
    };
  }
}

// Policy builder for easy policy creation
export class PolicyBuilder {
  private policy: Partial<Policy> = {
    subjects: [],
    resources: [],
    actions: [],
    environments: [],
    obligations: [],
    priority: 100,
  };

  id(id: string): this {
    this.policy.id = id;
    return this;
  }

  name(name: string): this {
    this.policy.name = name;
    return this;
  }

  description(description: string): this {
    this.policy.description = description;
    return this;
  }

  effect(effect: 'allow' | 'deny'): this {
    this.policy.effect = effect;
    return this;
  }

  allow(): this {
    return this.effect('allow');
  }

  deny(): this {
    return this.effect('deny');
  }

  subject(attribute: string, type: PolicyCondition['type'], value: any): this {
    this.policy.subjects!.push({ type, attribute, value });
    return this;
  }

  resource(attribute: string, type: PolicyCondition['type'], value: any): this {
    this.policy.resources!.push({ type, attribute, value });
    return this;
  }

  action(attribute: string, type: PolicyCondition['type'], value: any): this {
    this.policy.actions!.push({ type, attribute, value });
    return this;
  }

  environment(attribute: string, type: PolicyCondition['type'], value: any): this {
    this.policy.environments!.push({ type, attribute, value });
    return this;
  }

  obligation(type: string, params: Record<string, any> = {}): this {
    this.policy.obligations!.push({ type, params });
    return this;
  }

  priority(priority: number): this {
    this.policy.priority = priority;
    return this;
  }

  build(): Policy {
    if (!this.policy.id || !this.policy.name || !this.policy.effect) {
      throw new Error('Policy must have id, name, and effect');
    }
    return this.policy as Policy;
  }
}

// Pre-defined policies for EdgeCloud
export const DEFAULT_POLICIES: Policy[] = [
  // Admin has full access
  new PolicyBuilder()
    .id('admin-full-access')
    .name('Admin Full Access')
    .description('Administrators have full access to all resources')
    .allow()
    .subject('roles', 'contains', 'admin')
    .priority(1000)
    .build(),

  // Operators can manage tasks and nodes
  new PolicyBuilder()
    .id('operator-manage')
    .name('Operator Management Access')
    .description('Operators can manage tasks and nodes')
    .allow()
    .subject('roles', 'contains', 'operator')
    .resource('type', 'in', ['task', 'node'])
    .action('name', 'in', ['create', 'read', 'update', 'delete', 'schedule'])
    .priority(500)
    .build(),

  // Users can read and create tasks
  new PolicyBuilder()
    .id('user-task-access')
    .name('User Task Access')
    .description('Users can create and read tasks')
    .allow()
    .subject('roles', 'contains', 'user')
    .resource('type', 'equals', 'task')
    .action('name', 'in', ['create', 'read'])
    .priority(200)
    .build(),

  // Users can only access their own tasks
  new PolicyBuilder()
    .id('user-own-tasks')
    .name('User Own Tasks Only')
    .description('Users can only modify their own tasks')
    .allow()
    .subject('roles', 'contains', 'user')
    .resource('type', 'equals', 'task')
    .resource('ownerId', 'equals', '${subject.id}')
    .action('name', 'in', ['update', 'delete'])
    .priority(300)
    .build(),

  // Deny access outside business hours for non-admins
  new PolicyBuilder()
    .id('business-hours-only')
    .name('Business Hours Restriction')
    .description('Non-admins cannot access outside business hours')
    .deny()
    .subject('roles', 'notContains', 'admin')
    .environment('isBusinessHours', 'equals', false)
    .action('name', 'notEquals', 'read')
    .priority(100)
    .build(),

  // Region-based access
  new PolicyBuilder()
    .id('region-access')
    .name('Region-Based Access')
    .description('Users can only access resources in their region')
    .allow()
    .subject('roles', 'notContains', 'admin')
    .resource('region', 'equals', '${subject.attributes.region}')
    .priority(150)
    .build(),
];
