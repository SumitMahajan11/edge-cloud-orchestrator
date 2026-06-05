import { beforeEach, describe, expect, it } from "vitest";

import {
  ABACEngine,
  Action,
  DEFAULT_POLICIES,
  Environment,
  PolicyBuilder,
  Resource,
  Subject,
} from "../src/abac";

describe("ABACEngine", () => {
  let engine: ABACEngine;

  beforeEach(() => {
    engine = new ABACEngine();
  });

  describe("policy management", () => {
    it("should add and retrieve policies", () => {
      const policy = new PolicyBuilder()
        .id("test-policy")
        .name("Test Policy")
        .allow()
        .subject("roles", "contains", "admin")
        .resource("type", "equals", "task")
        .action("name", "equals", "create")
        .build();

      engine.addPolicy(policy);

      expect(engine.getPolicies()).toHaveLength(1);
    });

    it("should remove policies", () => {
      const policy = new PolicyBuilder()
        .id("test-policy")
        .name("Test Policy")
        .allow()
        .build();

      engine.addPolicy(policy);
      engine.removePolicy("test-policy");

      expect(engine.getPolicies()).toHaveLength(0);
    });
  });

  describe("access decisions", () => {
    beforeEach(() => {
      // Add test policies
      engine.addPolicy(
        new PolicyBuilder()
          .id("admin-full-access")
          .name("Admin Access")
          .allow()
          .subject("roles", "contains", "admin")
          .priority(100)
          .build(),
      );

      engine.addPolicy(
        new PolicyBuilder()
          .id("user-read-tasks")
          .name("User Task Access")
          .allow()
          .subject("roles", "contains", "user")
          .resource("type", "equals", "task")
          .action("name", "equals", "read")
          .priority(50)
          .build(),
      );

      engine.addPolicy(
        new PolicyBuilder()
          .id("deny-guest-access")
          .name("Deny Guest")
          .deny()
          .subject("roles", "contains", "guest")
          .priority(10)
          .build(),
      );
    });

    it("should allow admin full access", async () => {
      const subject: Subject = {
        id: "user-1",
        type: "user",
        attributes: { roles: ["admin"] },
        roles: ["admin"],
      };

      const resource: Resource = {
        id: "task-1",
        type: "task",
        attributes: { type: "task" },
      };

      const action: Action = {
        name: "delete",
        attributes: { name: "delete" },
      };

      const environment: Environment = {
        time: new Date(),
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment,
      });

      expect(decision.allowed).toBe(true);
    });

    it("should allow user read access to tasks", async () => {
      const subject: Subject = {
        id: "user-2",
        type: "user",
        attributes: { roles: ["user"] },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "task-1",
        type: "task",
        attributes: { type: "task" },
      };

      const action: Action = {
        name: "read",
        attributes: { name: "read" },
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });

      expect(decision.allowed).toBe(true);
    });

    it("should deny user write access to tasks", async () => {
      const subject: Subject = {
        id: "user-2",
        type: "user",
        attributes: { roles: ["user"] },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "task-1",
        type: "task",
        attributes: { type: "task" },
      };

      const action: Action = {
        name: "delete",
        attributes: { name: "delete" },
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });

      expect(decision.allowed).toBe(false);
    });

    it("should deny guest access", async () => {
      const subject: Subject = {
        id: "guest-1",
        type: "user",
        attributes: { roles: ["guest"] },
        roles: ["guest"],
      };

      const resource: Resource = {
        id: "task-1",
        type: "task",
        attributes: { type: "task" },
      };

      const action: Action = {
        name: "read",
        attributes: { name: "read" },
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });

      expect(decision.allowed).toBe(false);
    });
  });

  describe("time-based conditions", () => {
    it("should deny access outside business hours", async () => {
      engine.addPolicy(
        new PolicyBuilder()
          .id("business-hours-only")
          .name("Business Hours Only")
          .allow()
          .environment("isBusinessHours", "equals", true)
          .build(),
      );

      // Create a date outside business hours (e.g., 2 AM)
      const nightTime = new Date();
      nightTime.setHours(2, 0, 0, 0);

      const subject: Subject = {
        id: "user-1",
        type: "user",
        attributes: { roles: ["user"] },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "sensitive-1",
        type: "sensitive",
        attributes: { type: "sensitive" },
      };

      const action: Action = {
        name: "access",
        attributes: { name: "access" },
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: nightTime, isBusinessHours: false },
      });

      expect(decision.allowed).toBe(false);
    });
  });

  describe("obligations", () => {
    it("should include obligations in decision", async () => {
      engine.addPolicy(
        new PolicyBuilder()
          .id("log-access")
          .name("Log Access")
          .allow()
          .obligation("log", { level: "info", message: "Task accessed" })
          .build(),
      );

      const subject: Subject = {
        id: "user-1",
        type: "user",
        attributes: { roles: ["user"] },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "task-1",
        type: "task",
        attributes: { type: "task" },
      };

      const action: Action = {
        name: "read",
        attributes: { name: "read" },
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });

      expect(decision.allowed).toBe(true);
      expect(decision.obligations).toBeDefined();
      expect(decision.obligations).toHaveLength(1);
      expect(decision.obligations[0].type).toBe("log");
    });
  });
});

describe("PolicyBuilder", () => {
  it("should build a complete policy", () => {
    const policy = new PolicyBuilder()
      .id("test-policy")
      .name("Test Policy")
      .allow()
      .subject("roles", "contains", "admin")
      .resource("type", "equals", "task")
      .action("name", "equals", "create")
      .environment("region", "in", ["us-east", "us-west"])
      .obligation("audit", { action: "log" })
      .priority(100)
      .build();

    expect(policy.id).toBe("test-policy");
    expect(policy.effect).toBe("allow");
    expect(policy.subjects).toHaveLength(1);
    expect(policy.resources).toHaveLength(1);
    expect(policy.actions).toHaveLength(1);
    expect(policy.environments).toHaveLength(1);
    expect(policy.obligations).toHaveLength(1);
    expect(policy.priority).toBe(100);
  });

  it("should create deny policy", () => {
    const policy = new PolicyBuilder()
      .id("deny-policy")
      .name("Deny Policy")
      .deny()
      .build();

    expect(policy.effect).toBe("deny");
  });
});

describe("DEFAULT_POLICIES", () => {
  it("should contain essential policies", () => {
    expect(DEFAULT_POLICIES.length).toBeGreaterThan(0);

    const policyIds = DEFAULT_POLICIES.map((p) => p.id);
    expect(policyIds).toContain("admin-full-access");
    expect(policyIds).toContain("user-task-access");
  });
});
