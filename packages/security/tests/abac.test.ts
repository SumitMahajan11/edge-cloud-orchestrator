import { describe, it, expect, beforeEach } from 'vitest';
import { ABACEngine, PolicyBuilder, DEFAULT_POLICIES, Subject, Resource, Action, Environment } from '../src/abac';

describe('ABACEngine', () => {
  let engine: ABACEngine;

  beforeEach(() => {
    engine = new ABACEngine();
  });

  describe('policy management', () => {
    it('should add and retrieve policies', () => {
      const policy = new PolicyBuilder('test-policy')
        .allow()
        .forSubject({ type: 'user', attributes: { role: 'admin' }})
        .forResource({ type: 'task', attributes: {} })
        .forAction({ name: 'create', attributes: {} })
        .build();
      
      engine.addPolicy(policy);
      
      expect(engine.getPolicies()).toHaveLength(1);
    });

    it('should remove policies', () => {
      const policy = new PolicyBuilder('test-policy')
        .allow()
        .build();
      
      engine.addPolicy(policy);
      engine.removePolicy('test-policy');
      
      expect(engine.getPolicies()).toHaveLength(0);
    });

    it('should clear all policies', () => {
      engine.addPolicy(new PolicyBuilder('policy-1').allow().build());
      engine.addPolicy(new PolicyBuilder('policy-2').allow().build());
      
      engine.clearPolicies();
      
      expect(engine.getPolicies()).toHaveLength(0);
    });
  });

  describe('access decisions', () => {
    beforeEach(() => {
      // Add test policies
      engine.addPolicy(
        new PolicyBuilder('admin-full-access')
          .allow()
          .forSubject({ type: 'user', attributes: { role: 'admin' }})
          .forResource({ type: '*', attributes: {} })
          .forAction({ name: '*', attributes: {} })
          .withPriority(100)
          .build()
      );

      engine.addPolicy(
        new PolicyBuilder('user-read-tasks')
          .allow()
          .forSubject({ type: 'user', attributes: { role: 'user' }})
          .forResource({ type: 'task', attributes: {} })
          .forAction({ name: 'read', attributes: {} })
          .withPriority(50)
          .build()
      );

      engine.addPolicy(
        new PolicyBuilder('deny-guest-access')
          .deny()
          .forSubject({ type: 'user', attributes: { role: 'guest' }})
          .forResource({ type: 'task', attributes: {} })
          .forAction({ name: '*', attributes: {} })
          .withPriority(10)
          .build()
      );
    });

    it('should allow admin full access', async () => {
      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        attributes: { role: 'admin' },
        roles: ['admin'],
      };
      
      const resource: Resource = {
        id: 'task-1',
        type: 'task',
        attributes: {},
      };
      
      const action: Action = {
        name: 'delete',
        attributes: {},
      };
      
      const environment: Environment = {
        time: new Date(),
      };
      
      const decision = await engine.evaluate({ subject, resource, action, environment });
      
      expect(decision.effect).toBe('allow');
    });

    it('should allow user read access to tasks', async () => {
      const subject: Subject = {
        id: 'user-2',
        type: 'user',
        attributes: { role: 'user' },
        roles: ['user'],
      };
      
      const resource: Resource = {
        id: 'task-1',
        type: 'task',
        attributes: {},
      };
      
      const action: Action = {
        name: 'read',
        attributes: {},
      };
      
      const decision = await engine.evaluate({ subject, resource, action, environment: { time: new Date() } });
      
      expect(decision.effect).toBe('allow');
    });

    it('should deny user write access to tasks', async () => {
      const subject: Subject = {
        id: 'user-2',
        type: 'user',
        attributes: { role: 'user' },
        roles: ['user'],
      };
      
      const resource: Resource = {
        id: 'task-1',
        type: 'task',
        attributes: {},
      };
      
      const action: Action = {
        name: 'delete',
        attributes: {},
      };
      
      const decision = await engine.evaluate({ subject, resource, action, environment: { time: new Date() } });
      
      expect(decision.effect).toBe('deny');
    });

    it('should deny guest access', async () => {
      const subject: Subject = {
        id: 'guest-1',
        type: 'user',
        attributes: { role: 'guest' },
        roles: ['guest'],
      };
      
      const resource: Resource = {
        id: 'task-1',
        type: 'task',
        attributes: {},
      };
      
      const action: Action = {
        name: 'read',
        attributes: {},
      };
      
      const decision = await engine.evaluate({ subject, resource, action, environment: { time: new Date() } });
      
      expect(decision.effect).toBe('deny');
    });
  });

  describe('time-based conditions', () => {
    it('should deny access outside business hours', async () => {
      engine.addPolicy(
        new PolicyBuilder('business-hours-only')
          .allow()
          .forSubject({ type: 'user', attributes: {} })
          .forResource({ type: 'sensitive', attributes: {} })
          .forAction({ name: 'access', attributes: {} })
          .withCondition('time', { businessHours: true })
          .build()
      );

      // Create a date outside business hours (e.g., 2 AM)
      const nightTime = new Date();
      nightTime.setHours(2, 0, 0, 0);

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        attributes: {},
        roles: [],
      };
      
      const resource: Resource = {
        id: 'sensitive-1',
        type: 'sensitive',
        attributes: {},
      };
      
      const action: Action = {
        name: 'access',
        attributes: {},
      };
      
      const decision = await engine.evaluate({ 
        subject, 
        resource, 
        action, 
        environment: { time: nightTime } 
      });
      
      expect(decision.effect).toBe('deny');
    });
  });

  describe('obligations', () => {
    it('should include obligations in decision', async () => {
      engine.addPolicy(
        new PolicyBuilder('log-access')
          .allow()
          .forSubject({ type: 'user', attributes: {} })
          .forResource({ type: 'task', attributes: {} })
          .forAction({ name: 'read', attributes: {} })
          .withObligation('log', { level: 'info', message: 'Task accessed' })
          .build()
      );

      const subject: Subject = {
        id: 'user-1',
        type: 'user',
        attributes: {},
        roles: [],
      };
      
      const resource: Resource = {
        id: 'task-1',
        type: 'task',
        attributes: {},
      };
      
      const action: Action = {
        name: 'read',
        attributes: {},
      };
      
      const decision = await engine.evaluate({ 
        subject, 
        resource, 
        action, 
        environment: { time: new Date() } 
      });
      
      expect(decision.obligations).toBeDefined();
      expect(decision.obligations).toHaveLength(1);
      expect(decision.obligations![0].type).toBe('log');
    });
  });
});

describe('PolicyBuilder', () => {
  it('should build a complete policy', () => {
    const policy = new PolicyBuilder('test-policy')
      .allow()
      .forSubject({ type: 'user', attributes: { role: 'admin' }})
      .forResource({ type: 'task', attributes: { status: 'active' }})
      .forAction({ name: 'create', attributes: {} })
      .withCondition('region', { allowed: ['us-east', 'us-west'] })
      .withObligation('audit', { action: 'log' })
      .withPriority(100)
      .build();
    
    expect(policy.id).toBe('test-policy');
    expect(policy.effect).toBe('allow');
    expect(policy.subjects).toHaveLength(1);
    expect(policy.resources).toHaveLength(1);
    expect(policy.actions).toHaveLength(1);
    expect(policy.conditions).toHaveLength(1);
    expect(policy.obligations).toHaveLength(1);
    expect(policy.priority).toBe(100);
  });

  it('should create deny policy', () => {
    const policy = new PolicyBuilder('deny-policy')
      .deny()
      .build();
    
    expect(policy.effect).toBe('deny');
  });
});

describe('DEFAULT_POLICIES', () => {
  it('should contain essential policies', () => {
    expect(DEFAULT_POLICIES.length).toBeGreaterThan(0);
    
    const policyIds = DEFAULT_POLICIES.map(p => p.id);
    expect(policyIds).toContain('admin-full-access');
    expect(policyIds).toContain('user-read-access');
  });
});
