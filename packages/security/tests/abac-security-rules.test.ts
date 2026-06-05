import { beforeEach, describe, expect, it } from "vitest";

import {
  ABACEngine,
  Action,
  DEFAULT_POLICIES,
  PolicyBuilder,
  Resource,
  Subject,
} from "../src/abac";

describe("ABAC Security Rules Validation", () => {
  let engine: ABACEngine;

  beforeEach(() => {
    engine = new ABACEngine();
    // Initialize with default production-grade policies
    for (const policy of DEFAULT_POLICIES) {
      engine.addPolicy(policy);
    }
  });

  describe("Administrative Control", () => {
    it("should allow admin full access to any resource and action", async () => {
      const subject: Subject = {
        id: "admin-1",
        type: "user",
        attributes: { roles: ["admin"] },
        roles: ["admin"],
      };

      const resource: Resource = {
        id: "any-resource",
        type: "system",
        attributes: { tenantId: "tenant-A" },
      };

      const action: Action = {
        name: "delete-all",
        attributes: {},
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });
      expect(decision.allowed).toBe(true);
      expect(decision.matchedPolicies).toContain("admin-full-access");
    });
  });

  describe("Tenant Isolation", () => {
    it("should allow user to access resource in their own tenant", async () => {
      const subject: Subject = {
        id: "user-A",
        type: "user",
        attributes: {
          roles: ["user"],
          tenantId: "tenant-A",
        },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "task-A",
        type: "task",
        attributes: {
          type: "task",
          tenantId: "tenant-A",
        },
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

    it("should deny user access to resource in a different tenant", async () => {
      const subject: Subject = {
        id: "user-A",
        type: "user",
        attributes: {
          roles: ["user"],
          tenantId: "tenant-A",
        },
        roles: ["user"],
      };

      const resource: Resource = {
        id: "task-B",
        type: "task",
        attributes: {
          type: "task",
          tenantId: "tenant-B",
        },
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
      expect(decision.matchedPolicies).toContain("tenant-isolation");
    });

    it("should allow admin to access resources across tenants", async () => {
      const subject: Subject = {
        id: "admin-1",
        type: "user",
        attributes: { roles: ["admin"] },
        roles: ["admin"],
      };

      const resource: Resource = {
        id: "task-B",
        type: "task",
        attributes: { tenantId: "tenant-B" },
      };

      const action: Action = {
        name: "read",
        attributes: {},
      };

      const decision = await engine.evaluate({
        subject,
        resource,
        action,
        environment: { time: new Date() },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("Backward Compatibility", () => {
    it("should support legacy forSubject API", () => {
      const builder = new PolicyBuilder();

      // Complex object style
      builder
        .id("test-legacy")
        .name("Test Legacy")
        .allow()
        .forSubject({
          type: "user",
          attributes: { role: "manager" },
        });

      const policy = builder.build();
      expect(policy.subjects).toContainEqual({
        attribute: "type",
        type: "equals",
        value: "user",
      });
      expect(policy.subjects).toContainEqual({
        attribute: "role",
        type: "equals",
        value: "manager",
      });
    });
  });
});
