import Fastify from "fastify";
import fs from "fs";
import https from "https";
import path from "path";
import axios from "axios";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as x509 from "@peculiar/x509";
import { webcrypto } from "crypto";

import {
  createMtlsAgent,
  createMtlsServer,
} from "../../packages/security/src/tls";

const TEST_CERTS_DIR = path.join(__dirname, "../temp-certs");

async function generateTestCerts() {
  // Generate CA keys
  const caKeys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  // Create self-signed CA cert
  const caCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=TestCA",
    notBefore: new Date(Date.now() - 3600000), // 1 hour ago
    notAfter: new Date(Date.now() + 30 * 86400000), // 30 days
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    keys: caKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  // Generate Server keys
  const serverKeys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  // Create Server cert signed by CA
  const serverCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=test-server.edgecloud.local",
    issuer: "CN=TestCA",
    notBefore: new Date(Date.now() - 3600000),
    notAfter: new Date(Date.now() + 30 * 86400000), // 30 days
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    publicKey: serverKeys.publicKey,
    signingKey: caKeys.privateKey,
  });

  // Generate Client keys
  const clientKeys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  // Create Client cert signed by CA
  const clientCert = await x509.X509CertificateGenerator.create({
    serialNumber: "03",
    subject: "CN=test-client.edgecloud.local",
    issuer: "CN=TestCA",
    notBefore: new Date(Date.now() - 3600000),
    notAfter: new Date(Date.now() + 30 * 86400000), // 30 days
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    publicKey: clientKeys.publicKey,
    signingKey: caKeys.privateKey,
  });

  // Export private keys to PEM format
  const exportPrivateKeyPem = async (key: webcrypto.CryptoKey) => {
    const buf = await webcrypto.subtle.exportKey("pkcs8", key);
    return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(buf)
      .toString("base64")
      .match(/.{1,64}/g)
      ?.join("\n")}\n-----END PRIVATE KEY-----`;
  };

  const caKeyPem = await exportPrivateKeyPem(caKeys.privateKey);
  const serverKeyPem = await exportPrivateKeyPem(serverKeys.privateKey);
  const clientKeyPem = await exportPrivateKeyPem(clientKeys.privateKey);

  // Save them
  fs.writeFileSync(path.join(TEST_CERTS_DIR, "ca.crt"), caCert.toString("pem"));
  fs.writeFileSync(path.join(TEST_CERTS_DIR, "ca.key"), caKeyPem);

  fs.writeFileSync(
    path.join(TEST_CERTS_DIR, "server.crt"),
    serverCert.toString("pem"),
  );
  fs.writeFileSync(path.join(TEST_CERTS_DIR, "server.key"), serverKeyPem);

  fs.writeFileSync(
    path.join(TEST_CERTS_DIR, "client.crt"),
    clientCert.toString("pem"),
  );
  fs.writeFileSync(path.join(TEST_CERTS_DIR, "client.key"), clientKeyPem);
}

beforeAll(async () => {
  if (!fs.existsSync(TEST_CERTS_DIR)) {
    fs.mkdirSync(TEST_CERTS_DIR, { recursive: true });
  }
  await generateTestCerts();
});

afterAll(() => {
  // Cleanup
  if (fs.existsSync(TEST_CERTS_DIR)) {
    fs.rmSync(TEST_CERTS_DIR, { recursive: true, force: true });
  }
});

test("mTLS server should reject connections without client certificate", async () => {
  const server = Fastify({
    https: createMtlsServer({
      certPath: `${TEST_CERTS_DIR}/server.crt`,
      keyPath: `${TEST_CERTS_DIR}/server.key`,
      caPath: `${TEST_CERTS_DIR}/ca.crt`,
      serviceName: "test-server",
    }),
  });

  server.get("/ping", async () => "pong");
  await server.listen({ port: 0 });
  const address = server.server.address() as any;
  const url = `https://localhost:${address.port}/ping`;

  // Request without client cert
  const agent = new https.Agent({
    rejectUnauthorized: false, // Skip server cert validation, but we don't send client cert
  });

  try {
    await axios.get(url, { httpsAgent: agent, timeout: 1000 });
    throw new Error("Should have failed");
  } catch (err: any) {
    // Expect connection reset or 400
    expect(err.code).toBeDefined();
    expect([
      "ECONNRESET",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ECONNREFUSED",
      "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
      "ERR_SSL_TLSV13_ALERT_BAD_CERTIFICATE",
      "EPROTO",
    ]).toContain(err.code);
  } finally {
    await server.close();
  }
});

test("mTLS server should accept connections with valid client certificate", async () => {
  const server = Fastify({
    https: createMtlsServer({
      certPath: `${TEST_CERTS_DIR}/server.crt`,
      keyPath: `${TEST_CERTS_DIR}/server.key`,
      caPath: `${TEST_CERTS_DIR}/ca.crt`,
      serviceName: "test-server",
    }),
  });

  server.get("/ping", async () => "pong");
  await server.listen({ port: 0 });
  const address = server.server.address() as any;
  const url = `https://localhost:${address.port}/ping`;

  // Request with valid client cert
  const agent = createMtlsAgent({
    certPath: `${TEST_CERTS_DIR}/client.crt`,
    keyPath: `${TEST_CERTS_DIR}/client.key`,
    caPath: `${TEST_CERTS_DIR}/ca.crt`,
    serviceName: "test-client",
  });

  // Need to disable hostname check for localhost test
  (agent as any).options.checkServerIdentity = () => undefined;

  const res = await axios.get(url, { httpsAgent: agent });
  expect(res.data).toBe("pong");
  expect(res.status).toBe(200);

  await server.close();
});
