import fs from "fs";
import crypto from "crypto";
import type { AgentConfig, TaskPayload } from "./types";
import pino from "pino";

const logger = pino({ name: "edge-agent-security" });

export class CertManager {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  getSecureContextOptions() {
    if (!this.config.ENABLE_MTLS) {return null;}

    const cert = fs.readFileSync(this.config.TLS_CERT_PATH);
    const key = fs.readFileSync(this.config.TLS_KEY_PATH);
    const ca = fs.readFileSync(this.config.TLS_CA_PATH);

    this.validateCertExpiry(cert);

    return {
      cert,
      key,
      ca,
      minVersion: "TLSv1.3" as const,
      maxVersion: "TLSv1.3" as const,
      requestCert: true,
      rejectUnauthorized: true,
    };
  }

  private validateCertExpiry(certBuf: Buffer) {
    try {
      const x509 = new crypto.X509Certificate(certBuf);
      const validTo = new Date(x509.validTo);
      const now = new Date();
      const diffDays = Math.ceil(
        (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays < 7) {
        throw new Error(
          `FATAL: Certificate expires in ${diffDays} days! Refusing to start.`,
        );
      } else if (diffDays < 30) {
        logger.warn(
          `WARNING: Certificate expires in ${diffDays} days. Please rotate soon.`,
        );
      }
    } catch (err: any) {
      if (err.message.includes("FATAL")) {throw err;}
      logger.error("Failed to validate certificate expiry:", err);
    }
  }

  updateCerts(newCert: string, newKey: string, newCa?: string) {
    // Validate before writing
    try {
      const x509 = new crypto.X509Certificate(newCert);
      if (new Date(x509.validTo) < new Date()) {
        throw new Error("New certificate is already expired");
      }
    } catch (err) {
      throw new Error(
        `Invalid certificate: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    fs.writeFileSync(this.config.TLS_CERT_PATH, newCert);
    fs.writeFileSync(this.config.TLS_KEY_PATH, newKey);
    if (newCa) {
      fs.writeFileSync(this.config.TLS_CA_PATH, newCa);
    }

    logger.info("Certificates updated and persisted to disk");
  }
}

export function verifySignature(
  payload: any,
  signature: string,
  secret: string,
): boolean {
  if (!signature) {return false;}

  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

import { TaskInputSchema, TaskMetadataSchema } from "@edgecloud/shared-kernel";

export function validateTaskPayload(
  payload: TaskPayload,
  config: AgentConfig,
): { valid: boolean; error?: string } {
  // Size check
  if (JSON.stringify(payload).length > 1024 * 1024) {
    return { valid: false, error: "Payload exceeds 1MB limit" };
  }

  // Schema checks
  if (payload.input) {
    const res = TaskInputSchema.safeParse(payload.input);
    if (!res.success) {
      return {
        valid: false,
        error:
          `Invalid input payload: ${ 
          res.error.issues[0]?.message ?? "Unknown error"}`,
      };
    }
  }

  if (payload.metadata) {
    const res = TaskMetadataSchema.safeParse(payload.metadata);
    if (!res.success) {
      return {
        valid: false,
        error:
          `Invalid metadata payload: ${ 
          res.error.issues[0]?.message ?? "Unknown error"}`,
      };
    }
  }

  // Image allowlist
  const regex = new RegExp(config.IMAGE_ALLOWLIST_REGEX);
  if (!regex.test(payload.image)) {
    return {
      valid: false,
      error: `Image ${payload.image} not allowed by policy`,
    };
  }

  // Block :latest
  if (payload.image.includes(":latest") || !payload.image.includes(":")) {
    return {
      valid: false,
      error: "Tag :latest is strictly forbidden in production",
    };
  }

  return { valid: true };
}
