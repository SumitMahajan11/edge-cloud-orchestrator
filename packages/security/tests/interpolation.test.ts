import { describe, expect, it } from "vitest";

import {
  ABACEngine,
  type Action,
  PolicyBuilder,
  type Resource,
  type Subject,
} from "../src/abac";

describe("ABAC Engine Interpolation", () => {
  it("should resolve ${subject.id} in resource conditions", async () => {
    const engine = new ABACEngine();

    engine.addPolicy(
      new PolicyBuilder()
        .id("owner-access")
        .name("Owner Access")
        .allow()
        .resource("ownerId", "equals", "${subject.id}")
        .build(),
    );

    const subject: Subject = {
      id: "user-123",
      type: "user",
      attributes: { roles: ["user"] },
      roles: ["user"],
    };

    const resource: Resource = {
      id: "task-1",
      type: "task",
      attributes: { ownerId: "user-123" },
    };

    const action: Action = {
      name: "update",
      attributes: {},
    };

    const decision = await engine.evaluate({
      subject,
      resource,
      action,
      environment: { time: new Date() },
    });

    // This will likely FAIL if interpolation is not implemented
    expect(decision.allowed).toBe(true);
  });
});
