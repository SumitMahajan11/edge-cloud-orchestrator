import { test, expect, beforeAll, afterAll } from 'vitest';
import https from 'https';
import axios from 'axios';
import Fastify from 'fastify';
import { createMtlsServer, createMtlsAgent } from '../../security/src/tls';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TEST_CERTS_DIR = path.join(__dirname, '../temp-certs');

beforeAll(() => {
  if (!fs.existsSync(TEST_CERTS_DIR)) {
    fs.mkdirSync(TEST_CERTS_DIR, { recursive: true });
  }

  // Generate self-signed CA and certs for testing if openssl is available
  try {
    execSync(`
      openssl genrsa -out ${TEST_CERTS_DIR}/ca.key 2048
      openssl req -x509 -new -nodes -key ${TEST_CERTS_DIR}/ca.key -sha256 -days 1 -out ${TEST_CERTS_DIR}/ca.crt -subj "/CN=TestCA"
      
      openssl genrsa -out ${TEST_CERTS_DIR}/server.key 2048
      openssl req -new -key ${TEST_CERTS_DIR}/server.key -out ${TEST_CERTS_DIR}/server.csr -subj "/CN=test-server.edgecloud.local"
      openssl x509 -req -in ${TEST_CERTS_DIR}/server.csr -CA ${TEST_CERTS_DIR}/ca.crt -CAkey ${TEST_CERTS_DIR}/ca.key -CAcreateserial -out ${TEST_CERTS_DIR}/server.crt -days 1 -sha256
      
      openssl genrsa -out ${TEST_CERTS_DIR}/client.key 2048
      openssl req -new -key ${TEST_CERTS_DIR}/client.key -out ${TEST_CERTS_DIR}/client.csr -subj "/CN=test-client.edgecloud.local"
      openssl x509 -req -in ${TEST_CERTS_DIR}/client.csr -CA ${TEST_CERTS_DIR}/ca.crt -CAkey ${TEST_CERTS_DIR}/ca.key -CAcreateserial -out ${TEST_CERTS_DIR}/client.crt -days 1 -sha256
    `);
  } catch (err) {
    console.warn('Skipping cert generation in test (openssl not found). Assuming certs exist or test will fail.');
  }
});

afterAll(() => {
  // Cleanup
  if (fs.existsSync(TEST_CERTS_DIR)) {
    fs.rmSync(TEST_CERTS_DIR, { recursive: true, force: true });
  }
});

test('mTLS server should reject connections without client certificate', async () => {
  const server = Fastify({
    https: createMtlsServer({
      certPath: `${TEST_CERTS_DIR}/server.crt`,
      keyPath: `${TEST_CERTS_DIR}/server.key`,
      caPath: `${TEST_CERTS_DIR}/ca.crt`,
      serviceName: 'test-server'
    })
  });

  server.get('/ping', async () => 'pong');
  await server.listen({ port: 0 });
  const address = server.server.address() as any;
  const url = `https://localhost:${address.port}/ping`;

  // Request without client cert
  const agent = new https.Agent({
    rejectUnauthorized: false // Skip server cert validation, but we don't send client cert
  });

  try {
    await axios.get(url, { httpsAgent: agent, timeout: 1000 });
    throw new Error('Should have failed');
  } catch (err: any) {
    // Expect connection reset or 400
    expect(err.code).toBeDefined();
    // In node, a rejected mTLS connection often shows as ECONNRESET or an SSL error
    expect(['ECONNRESET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ECONNREFUSED']).toContain(err.code);
  } finally {
    await server.close();
  }
});

test('mTLS server should accept connections with valid client certificate', async () => {
  const server = Fastify({
    https: createMtlsServer({
      certPath: `${TEST_CERTS_DIR}/server.crt`,
      keyPath: `${TEST_CERTS_DIR}/server.key`,
      caPath: `${TEST_CERTS_DIR}/ca.crt`,
      serviceName: 'test-server'
    })
  });

  server.get('/ping', async () => 'pong');
  await server.listen({ port: 0 });
  const address = server.server.address() as any;
  const url = `https://localhost:${address.port}/ping`;

  // Request with valid client cert
  const agent = createMtlsAgent({
    certPath: `${TEST_CERTS_DIR}/client.crt`,
    keyPath: `${TEST_CERTS_DIR}/client.key`,
    caPath: `${TEST_CERTS_DIR}/ca.crt`,
    serviceName: 'test-client'
  });
  
  // Need to disable hostname check for localhost test
  (agent as any).options.checkServerIdentity = () => undefined;

  const res = await axios.get(url, { httpsAgent: agent });
  expect(res.data).toBe('pong');
  expect(res.status).toBe(200);

  await server.close();
});
