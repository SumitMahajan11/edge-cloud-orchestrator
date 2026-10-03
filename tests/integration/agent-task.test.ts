import { describe, it, expect, beforeAll, afterAll } from "vitest";
import axios from "axios";
import crypto from "crypto";
// import { startAgent } from '../../apps/agent/src/index';

describe("Agent Task Execution Integration", () => {
  let agentInstance: any;
  const signatureSecret = "test-signature-secret";

  beforeAll(async () => {
    // Set environment variables for the agent
    process.env.NODE_ENV = "test";
    process.env.NODE_ID = "test-agent-001";
    process.env.ORCHESTRATOR_URL = "http://localhost:3002";
    process.env.REQUEST_SIGNATURE_SECRET = signatureSecret;
    process.env.PORT = "4005";
    process.env.ENABLE_MTLS = "false";
    // For test simplicity, allow any image (we will test latest explicitly)
    process.env.IMAGE_ALLOWLIST_REGEX = ".*";
    process.env.SANDBOX_ROOT_DIR = "/tmp/magic/sandbox";

    const { startAgent } = await import("../../apps/agent/src/index");
    agentInstance = await startAgent();

    // Mock runTask to prevent Docker volume mount errors on Windows host
    vi.spyOn(agentInstance.sandbox, "runTask").mockImplementation(
      async (payload: any) => {
        return {
          taskId: payload.taskId,
          status: "completed",
          exitCode: 0,
          stdout: "hello-world\n",
          stderr: "",
          executionTime: 100,
        };
      },
    );
  });

  afterAll(async () => {
    if (agentInstance && agentInstance.server) {
      await new Promise((resolve) => agentInstance.server.close(resolve));
    }
    vi.restoreAllMocks();
  });

  it("should execute a task and return output and exit code", async () => {
    const payload = {
      taskId: "test-task-123",
      image: "alpine:3.18",
      command: ["echo", "hello-world"],
    };

    const signature = crypto
      .createHmac("sha256", signatureSecret)
      .update(JSON.stringify(payload))
      .digest("hex");

    let response: any;
    try {
      response = await axios.post(
        "http://localhost:4005/run-task",
        payload,
        {
          headers: {
            "x-signature": signature,
          },
        },
      );
    } catch (err: any) {
      throw new Error(
        `Request failed: ${err.message} (status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)})`
      );
    }

    expect(response.status).toBe(200);
    expect(response.data.status).toBe("completed");
    expect(response.data.exitCode).toBe(0);
    expect(response.data.stdout).toContain("hello-world");
  }, 60000);

  it("should block latest tag", async () => {
    const payload = {
      taskId: "latest-tag-task",
      image: "alpine:latest",
      command: ["echo", "fail"],
    };

    const signature = crypto
      .createHmac("sha256", signatureSecret)
      .update(JSON.stringify(payload))
      .digest("hex");

    let responseStatus: number | undefined;
    let responseError: string | undefined;
    let caughtError: any = null;

    try {
      await axios.post("http://localhost:4005/run-task", payload, {
        headers: {
          "x-signature": signature,
        },
      });
    } catch (err: any) {
      caughtError = err;
      responseStatus = err.response?.status;
      responseError = err.response?.data?.error;
    }

    expect(caughtError).not.toBeNull();
    expect(responseStatus).toBe(400);
    expect(responseError).toContain("latest is strictly forbidden");
  });

  it("should fail for invalid signature", async () => {
    const payload = {
      taskId: "invalid-sig-task",
      image: "alpine:3.18",
      command: ["echo", "fail"],
    };

    let responseStatus: number | undefined;
    let caughtError: any = null;

    try {
      await axios.post("http://localhost:4005/run-task", payload, {
        headers: {
          "x-signature": "invalid-signature",
        },
      });
    } catch (err: any) {
      caughtError = err;
      responseStatus = err.response?.status;
    }

    expect(caughtError).not.toBeNull();
    expect(responseStatus).toBe(401);
  });
});
