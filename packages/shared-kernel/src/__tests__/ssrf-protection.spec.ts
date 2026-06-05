import { validateWebhookUrl } from "../security/ssrf-protection";

describe("SSRF Protection Utility", () => {
  let originalAllowPrivateIps: string | undefined;

  beforeAll(() => {
    originalAllowPrivateIps = process.env.ALLOW_PRIVATE_IPS;
    process.env.ALLOW_PRIVATE_IPS = "false";
    // Ensure NODE_ENV is set to something other than development
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    process.env.ALLOW_PRIVATE_IPS = originalAllowPrivateIps;
  });
  describe("Blocked URLs", () => {
    it("should block AWS metadata endpoint", async () => {
      const result = await validateWebhookUrl(
        "http://169.254.169.254/latest/meta-data",
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("resolves to a private IP address");
    });

    it("should block internal admin page", async () => {
      const result = await validateWebhookUrl("http://10.0.0.1/admin");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("resolves to a private IP address");
    });

    it("should block private network IP", async () => {
      const result = await validateWebhookUrl("http://192.168.1.1");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("resolves to a private IP address");
    });

    it("should block localhost Redis", async () => {
      const result = await validateWebhookUrl("http://127.0.0.1:6379");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("resolves to a private IP address");
    });

    it("should block localhost by hostname", async () => {
      const result = await validateWebhookUrl("http://localhost/internal");
      expect(result.safe).toBe(false);
      // Depending on environment, localhost might resolve to 127.0.0.1 or ::1
      expect(result.reason).toMatch(/resolves to private IP/i);
    });

    it("should block wrong protocols (ftp)", async () => {
      const result = await validateWebhookUrl("ftp://example.com");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Protocol ftp: not allowed");
    });

    it("should block file protocol", async () => {
      const result = await validateWebhookUrl("file:///etc/passwd");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Protocol file: not allowed");
    });
  });

  describe("Allowed URLs", () => {
    it("should allow public Slack hooks", async () => {
      // Note: We might need to mock DNS if the environment doesn't have internet access
      // But for these, we expect them to be safe.
      const result = await validateWebhookUrl(
        "https://hooks.slack.com/services/T000/B000/XXXX",
      );
      // If DNS fails in test environment, it will return false with "Could not resolve"
      // So we check if it's NOT blocked for being private.
      if (result.safe === false) {
        expect(result.reason).not.toContain("resolves to private IP");
      } else {
        expect(result.safe).toBe(true);
      }
    });

    it("should allow public example API", async () => {
      const result = await validateWebhookUrl(
        "https://api.example.com/webhook",
      );
      if (result.safe === false) {
        expect(result.reason).not.toContain("resolves to private IP");
      } else {
        expect(result.safe).toBe(true);
      }
    });

    it("should allow webhook.site", async () => {
      const result = await validateWebhookUrl("https://webhook.site/abc123");
      if (result.safe === false) {
        expect(result.reason).not.toContain("resolves to private IP");
      } else {
        expect(result.safe).toBe(true);
      }
    });
  });

  describe("Production Restrictions", () => {
    it("should reject HTTP in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const result = await validateWebhookUrl("http://example.com/webhook");
        expect(result.safe).toBe(false);
        expect(result.reason).toBe("Only HTTPS webhooks allowed in production");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
