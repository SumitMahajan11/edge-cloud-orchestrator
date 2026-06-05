import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import bcrypt from "bcryptjs";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.FORCE_MOCK_DB = "true";
  process.env.FORCE_MOCK_REDIS = "true";
  process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  process.env.ENCRYPTION_KEY = "test-key-at-least-32-characters-long";
  process.env.ELECTRICITY_MAPS_API_KEY = "";
});

import { app, init } from "../../apps/api/src/index";
import {
  mockNodes,
  mockTasks,
  mockUsers,
} from "../../apps/api/src/initializers/mock-prisma";

describe("Critical Endpoints API Contract Verification", () => {
  let testToken: string;
  let ajv: Ajv;
  let openapi: any;

  beforeAll(async () => {
    // Initialize the app
    await init();
    await app.ready();

    // Setup AJV
    ajv = new Ajv({
      allErrors: true,
      strict: false,
      formats: {
        "date-time": true,
        uuid: true,
        email: true,
        ipv4: true,
      },
    });
    addFormats(ajv);

    // Load spec for schemas
    const specPath = path.resolve(__dirname, "../../apps/api/openapi-v2.yml");
    const specContent = fs.readFileSync(specPath, "utf8");
    openapi = yaml.parse(specContent);

    // Generate a valid token
    testToken = jwt.sign(
      {
        id: "test-user-id",
        email: "test@example.com",
        role: "ADMIN",
        tenantId: "default-tenant",
        permissions: ["*"],
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "1h",
        issuer: "edge-cloud-orchestrator",
        audience: "edge-cloud-clients",
      },
    );

    // Prepopulate mock database maps
    mockUsers.clear();
    mockNodes.clear();
    mockTasks.clear();

    // Setup mock admin user
    mockUsers.set("test-user-id", {
      id: "test-user-id",
      email: "test@example.com",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv", // dummy bcrypt hash
      name: "Test Admin",
      role: "ADMIN",
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    });

    // Setup admin user for login tests
    mockUsers.set("00000000-0000-4000-b000-000000000001", {
      id: "00000000-0000-4000-b000-000000000001",
      email: "admin@example.com",
      passwordHash: bcrypt.hashSync("admin123", 10),
      name: "Admin User",
      role: "ADMIN",
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    });

    // Add a mock node
    mockNodes.set("00000000-0000-4000-a000-000000000001", {
      id: "00000000-0000-4000-a000-000000000001",
      name: "Test Node 1",
      status: "ONLINE",
      location: "us-east",
      ipAddress: "127.0.0.1",
      port: 8080,
      region: "us-east-1",
      capacity: 100,
      load: 10,
      tasksRunning: 1,
      tenantId: "default-tenant",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Add a mock task
    mockTasks.set("00000000-0000-4000-d000-000000000001", {
      id: "00000000-0000-4000-d000-000000000001",
      name: "Test Task 1",
      userId: "test-user-id",
      type: "IMAGE_CLASSIFICATION",
      status: "COMPLETED",
      payload: { image: "test.jpg" },
      priority: "MEDIUM",
      target: "EDGE",
      policy: "BEST_EFFORT",
      reason: "Standard execution",
      tenantId: "default-tenant",
      runtime: "DOCKER",
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const validateV2Response = (
    routePath: string,
    method: string,
    statusCode: number,
    body: any,
  ) => {
    let operation = openapi.paths[routePath]?.[method.toLowerCase()];
    if (!operation) {
      const alternativePath = routePath.endsWith("/")
        ? routePath.slice(0, -1)
        : `${routePath}/`;
      operation = openapi.paths[alternativePath]?.[method.toLowerCase()];
    }
    if (!operation) {
      throw new Error(
        `Operation ${method} ${routePath} not found in OpenAPI spec`,
      );
    }
    const responseSpec = operation.responses[statusCode];
    const schema = responseSpec?.content?.["application/json"]?.schema;
    if (!schema) {
      throw new Error(
        `Schema not found for ${method} ${routePath} response ${statusCode}`,
      );
    }

    const schemaWithComponents = {
      ...schema,
      components: openapi.components,
    };

    const validate = ajv.compile(schemaWithComponents);
    const valid = validate(body);
    if (!valid) {
      console.error(
        `Validation errors for ${method} ${routePath}:`,
        validate.errors,
      );
    }
    expect(
      valid,
      `Response for ${method} ${routePath} did not match spec schema: ${ajv.errorsText(validate.errors)}`,
    ).toBe(true);
  };

  // 1. Register V1 & V2
  describe("Authentication - Registration API", () => {
    const registerResponseSchema = {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["id", "email", "name", "role"],
        },
      },
      required: ["accessToken", "refreshToken", "user"],
    };

    it("POST /v1/auth/register meets contract", async () => {
      const email = `test-${Date.now()}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email,
          password: "SecurePassword123!",
          name: "Test Register One",
        },
      });

      if (response.statusCode !== 201) {
        console.error(
          "POST /v1/auth/register response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      const validate = ajv.compile(registerResponseSchema);
      expect(validate(body)).toBe(true);
    });

    it("POST /v2/auth/register meets contract", async () => {
      const email = `test-v2-${Date.now()}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/v2/auth/register",
        payload: {
          email,
          password: "SecurePassword123!",
          name: "Test Register Two",
        },
      });

      if (response.statusCode !== 201) {
        console.error(
          "POST /v2/auth/register response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/auth/register", "POST", 201, body);
    });
  });

  // 2. Login V1 & V2
  describe("Authentication - Login API", () => {
    const loginResponseSchema = {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["id", "email", "role"],
        },
      },
      required: ["accessToken", "refreshToken", "user"],
    };

    it("POST /v1/auth/login meets contract", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "admin@example.com",
          password: "admin123",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const validate = ajv.compile(loginResponseSchema);
      expect(validate(body)).toBe(true);
    });

    it("POST /v2/auth/login meets contract", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v2/auth/login",
        payload: {
          email: "admin@example.com",
          password: "admin123",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/auth/login", "POST", 200, body);
    });
  });

  // 3. List Nodes V1 & V2
  describe("Nodes - List Nodes API", () => {
    const v1NodesSchema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              status: { type: "string" },
              region: { type: "string" },
              tenantId: { type: "string" },
            },
            required: ["id", "name", "status"],
          },
        },
      },
      required: ["data"],
    };

    it("GET /v1/nodes meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/nodes",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const validate = ajv.compile(v1NodesSchema);
      expect(validate(body)).toBe(true);
    });

    it("GET /v2/nodes meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/nodes",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      if (response.statusCode !== 200) {
        console.error(
          "GET /v2/nodes response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/nodes", "GET", 200, body);
    });
  });

  // 4. List Tasks V1 & V2
  describe("Tasks - List Tasks API", () => {
    const v1TasksSchema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              status: { type: "string" },
              priority: { type: "string" },
            },
            required: ["id", "type", "status"],
          },
        },
      },
      required: ["data"],
    };

    it("GET /v1/tasks meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      if (response.statusCode !== 200) {
        console.error(
          "GET /v1/tasks response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const validate = ajv.compile(v1TasksSchema);
      expect(validate(body)).toBe(true);
    });

    it("GET /v2/tasks/ meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/tasks",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      if (response.statusCode !== 200) {
        console.error(
          "GET /v2/tasks/ response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/tasks", "GET", 200, body);
    });
  });

  // 5. Create Task V1 & V2
  describe("Tasks - Create Task API", () => {
    const v1CreateTaskSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
      },
      required: ["id", "name", "type", "status"],
    };

    it("POST /v1/tasks meets contract", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
        payload: {
          name: "image-classification-task-v1",
          type: "IMAGE_CLASSIFICATION",
          priority: "HIGH",
          target: "EDGE",
          image: "test-image:latest",
        },
      });

      if (response.statusCode !== 201) {
        console.error(
          "POST /v1/tasks response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      const validate = ajv.compile(v1CreateTaskSchema);
      expect(validate(body)).toBe(true);
    });

    it("POST /v2/tasks meets contract", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
        payload: {
          name: "image-classification-task-v2",
          type: "IMAGE_CLASSIFICATION",
          priority: "HIGH",
          target: "EDGE",
          image: "test-image:latest",
        },
      });

      if (response.statusCode !== 201) {
        console.error(
          "POST /v2/tasks response:",
          response.statusCode,
          response.payload,
        );
      }

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/tasks", "POST", 201, body);
    });
  });

  // 6. Carbon Intensity V2
  describe("Carbon - Intensity API", () => {
    it("GET /v2/carbon/intensity meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/carbon/intensity",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/carbon/intensity", "GET", 200, body);
    });
  });

  // 7. ML Drift Status V2
  describe("ML - Drift Status API", () => {
    it("GET /v2/ml/drift/current meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/ml/drift/current",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/ml/drift/current", "GET", 200, body);
    });
  });

  // 8. Scheduler Metrics V2
  describe("Scheduler - Metrics API", () => {
    it("GET /v2/scheduler/metrics meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/scheduler/metrics",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/scheduler/metrics", "GET", 200, body);
    });
  });

  // 9. Cost Analytics V2
  describe("Analytics - Cost API", () => {
    it("GET /v2/analytics/cost meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v2/analytics/cost",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      validateV2Response("/v2/analytics/cost", "GET", 200, body);
    });
  });

  // 10. Health check
  describe("System - Health API", () => {
    it("GET /health meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("status");
      expect(body.status).toBe("ok");
    });

    it("GET /v1/admin/health meets contract", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/admin/health",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("database");
      expect(body).toHaveProperty("redis");
      expect(body).toHaveProperty("timestamp");
    });
  });
});
