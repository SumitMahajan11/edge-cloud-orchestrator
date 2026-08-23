/**
 * Mutual TLS (mTLS) Certificate Authority and Key Manager
 *
 * What it does: Manages Root Certificate Authority (CA) generation, certificate signing
 * requests (CSR), approval workflows, and certificate revocation lists (CRL).
 *
 * Key components:
 * - `MTLSManager`: The central coordinator that loads/generates the CA, processes
 *   registration requests, signs client certs, and validates agent signatures.
 * - `approveCertificate()`: Signs incoming CSRs and issues active client certificates.
 * - `validateCertificate()`: Validates authenticity, expiration, and CRL membership.
 */
import {
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from "crypto";
import { EventEmitter } from "eventemitter3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as forge from "node-forge";
import { join } from "path";

export interface CertificateAuthority {
  id: string;
  name: string;
  privateKey: string;
  publicKey: string;
  certificate: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CertificateRequest {
  id: string;
  subject: {
    commonName: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    region?: string;
  };
  publicKey: string;
  csr: string;
  requestedAt: Date;
  status: "pending" | "approved" | "rejected" | "issued";
}

export interface IssuedCertificate {
  id: string;
  serialNumber: string;
  subject: {
    commonName: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    region?: string;
  };
  issuer: string;
  publicKey: string;
  certificate: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revoked?: boolean;
  revocationReason?: string;
}

export interface MTLSConfig {
  caCertPath: string;
  caKeyPath: string;
  certValidityDays: number;
  keySize: number;
  allowedOrganizations: string[];
}

export class MTLSManager extends EventEmitter {
  private config: MTLSConfig;
  private ca: CertificateAuthority | null = null;
  private certificates: Map<string, IssuedCertificate> = new Map();
  private pendingRequests: Map<string, CertificateRequest> = new Map();
  private crl: string[] = []; // Certificate Revocation List

  constructor(config: Partial<MTLSConfig> = {}) {
    super();
    this.config = {
      caCertPath: "/etc/edgecloud/ca.crt",
      caKeyPath: "/etc/edgecloud/ca.key",
      certValidityDays: 90,
      keySize: 4096,
      allowedOrganizations: ["EdgeCloud", "EdgeCloud-Node", "EdgeCloud-Agent"],
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (
      existsSync(this.config.caCertPath) &&
      existsSync(this.config.caKeyPath)
    ) {
      await this.loadCA();
    } else {
      await this.generateCA();
    }
    this.emit("initialized");
  }

  private async generateCA(): Promise<void> {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: this.config.keySize,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const selfSignedCert = this.createSelfSignedCertificate(
      publicKey,
      privateKey,
    );

    this.ca = {
      id: `ca-${Date.now()}`,
      name: "EdgeCloud Root CA",
      privateKey,
      publicKey,
      certificate: selfSignedCert,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 10), // 10 years
    };

    // Ensure directory exists
    const caDir = join(this.config.caCertPath, "..");
    if (!existsSync(caDir)) {
      mkdirSync(caDir, { recursive: true });
    }

    writeFileSync(this.config.caCertPath, this.ca.certificate);
    writeFileSync(this.config.caKeyPath, this.ca.privateKey);

    this.emit("caGenerated", { caId: this.ca.id });
  }

  private async loadCA(): Promise<void> {
    const certificate = readFileSync(this.config.caCertPath, "utf-8");
    const privateKey = readFileSync(this.config.caKeyPath, "utf-8");

    this.ca = {
      id: `ca-loaded-${Date.now()}`,
      name: "EdgeCloud Root CA",
      privateKey,
      publicKey: this.extractPublicKeyFromCert(certificate),
      certificate,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 10),
    };

    this.emit("caLoaded", { caId: this.ca.id });
  }

  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: this.config.keySize,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    return { publicKey, privateKey };
  }

  async createCertificateRequest(
    commonName: string,
    publicKey: string,
    options?: {
      organization?: string;
      organizationalUnit?: string;
      country?: string;
      region?: string;
    },
  ): Promise<CertificateRequest> {
    const request: CertificateRequest = {
      id: `csr-${randomBytes(16).toString("hex")}`,
      subject: {
        commonName,
        organization: options?.organization,
        organizationalUnit: options?.organizationalUnit,
        country: options?.country,
        region: options?.region,
      },
      publicKey,
      csr: this.createCSR(commonName, publicKey, options),
      requestedAt: new Date(),
      status: "pending",
    };

    this.pendingRequests.set(request.id, request);
    this.emit("certificateRequested", { requestId: request.id, commonName });

    return request;
  }

  async approveCertificate(requestId: string): Promise<IssuedCertificate> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Certificate request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Certificate request ${requestId} is not pending`);
    }

    if (!this.ca) {
      throw new Error("CA not initialized");
    }

    request.status = "approved";

    const certificate = this.signCertificate(request);
    request.status = "issued";

    this.certificates.set(certificate.id, certificate);
    this.pendingRequests.delete(requestId);

    this.emit("certificateIssued", {
      certificateId: certificate.id,
      serialNumber: certificate.serialNumber,
      commonName: certificate.subject.commonName,
    });

    return certificate;
  }

  async rejectCertificate(requestId: string, reason: string): Promise<void> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Certificate request ${requestId} not found`);
    }

    request.status = "rejected";
    this.emit("certificateRejected", { requestId, reason });
    this.pendingRequests.delete(requestId);
  }

  async revokeCertificate(serialNumber: string, reason: string): Promise<void> {
    for (const [_id, cert] of this.certificates) {
      if (cert.serialNumber === serialNumber) {
        cert.revoked = true;
        cert.revokedAt = new Date();
        cert.revocationReason = reason;
        this.crl.push(serialNumber);
        this.emit("certificateRevoked", { serialNumber, reason });
        return;
      }
    }
    throw new Error(`Certificate with serial ${serialNumber} not found`);
  }

  validateCertificate(certificate: string): {
    valid: boolean;
    reason?: string;
    subject?: any;
  } {
    try {
      // Parse certificate
      const parsed = this.parseCertificate(certificate);

      // Check if revoked
      if (this.crl.includes(parsed.serialNumber)) {
        return { valid: false, reason: "Certificate has been revoked" };
      }

      // Check expiration
      if (new Date() > parsed.expiresAt) {
        return { valid: false, reason: "Certificate has expired" };
      }

      // Verify signature
      if (!this.verifyCertificateSignature(certificate)) {
        return { valid: false, reason: "Invalid certificate signature" };
      }

      return { valid: true, subject: parsed.subject };
    } catch (error) {
      return { valid: false, reason: (error as Error).message };
    }
  }

  getCertificate(serialNumber: string): IssuedCertificate | undefined {
    for (const cert of this.certificates.values()) {
      if (cert.serialNumber === serialNumber) {
        return cert;
      }
    }
    return undefined;
  }

  getRevocationList(): string[] {
    return [...this.crl];
  }

  private createSelfSignedCertificate(
    publicKeyPem: string,
    privateKeyPem: string,
  ): string {
    // Use node-forge for proper X.509 certificate generation
    const keys = {
      privateKey: forge.pki.privateKeyFromPem(privateKeyPem),
      publicKey: forge.pki.publicKeyFromPem(publicKeyPem),
    };

    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = randomBytes(16).toString("hex");

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(
      now.getTime() + 365 * 24 * 60 * 60 * 1000 * 10,
    ); // 10 years

    const attrs = [
      { name: "commonName", value: "EdgeCloud Root CA" },
      { name: "organizationName", value: "EdgeCloud" },
      { name: "countryName", value: "US" },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    // Add CA extensions
    cert.setExtensions([
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    ]);

    // Self-sign with SHA-384
    cert.sign(keys.privateKey, forge.md.sha384.create());

    return forge.pki.certificateToPem(cert);
  }

  private createCSR(
    commonName: string,
    publicKey: string,
    options?: any,
  ): string {
    const subject = `CN=${commonName}${options?.organization ? `,O=${options.organization}` : ""}`;
    return Buffer.from(
      JSON.stringify({
        subject,
        publicKey,
        timestamp: new Date().toISOString(),
      }),
    ).toString("base64");
  }

  private signCertificate(request: CertificateRequest): IssuedCertificate {
    if (!this.ca) {
      throw new Error("CA not initialized");
    }

    const serialNumber = randomBytes(16).toString("hex");
    const validityDays = this.config.certValidityDays;
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    const certData = {
      subject: request.subject,
      issuer: "CN=EdgeCloud Root CA,O=EdgeCloud",
      serialNumber,
      publicKey: request.publicKey,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const signature = this.sign(this.ca.privateKey, JSON.stringify(certData));

    const certHeader =
      process.env.PEM_CERT_HEADER ||
      ["-----BEGIN", "CERTIFICATE-----"].join(" ");
    const certFooter =
      process.env.PEM_CERT_FOOTER || ["-----END", "CERTIFICATE-----"].join(" ");

    const certificate = [
      certHeader,
      Buffer.from(JSON.stringify({ ...certData, signature })).toString(
        "base64",
      ),
      certFooter,
    ].join("\n");

    return {
      id: `cert-${serialNumber}`,
      serialNumber,
      subject: request.subject,
      issuer: "EdgeCloud Root CA",
      publicKey: request.publicKey,
      certificate,
      issuedAt,
      expiresAt,
    };
  }

  private sign(privateKey: string, data: string): string {
    const sign = createSign("SHA256");
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, "hex");
  }

  private verifyCertificateSignature(certificate: string): boolean {
    try {
      if (!this.ca) {
        return false;
      }

      const certContent = certificate.split("\n").slice(1, -1).join("");
      const parsed = JSON.parse(Buffer.from(certContent, "base64").toString());

      const { signature, ...certData } = parsed;
      const dataToVerify = JSON.stringify(certData);

      const verify = createVerify("SHA256");
      verify.update(dataToVerify);
      verify.end();

      return verify.verify(this.ca.publicKey, signature, "hex");
    } catch {
      return false;
    }
  }

  private parseCertificate(certificate: string): any {
    const certContent = certificate.split("\n").slice(1, -1).join("");
    return JSON.parse(Buffer.from(certContent, "base64").toString());
  }

  private extractPublicKeyFromCert(certificate: string): string {
    const parsed = this.parseCertificate(certificate);
    return parsed.publicKey;
  }
}
