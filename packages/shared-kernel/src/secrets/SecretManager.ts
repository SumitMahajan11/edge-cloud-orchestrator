import fs from 'fs';

import path from 'path';
import vault from 'node-vault';

export interface SecretManager {
  getSecret(key: string): Promise<string | undefined>;
  /**
   * Issue a certificate from Vault PKI.
   * role: the Vault PKI role name (e.g., 'edge-agent')
   * commonName: the certificate common name (e.g., node ID)
   * ttl: optional time-to-live string (e.g., '720h')
   */
  issueCertificate?(role: string, commonName: string, ttl?: string): Promise<{ certificate: string; private_key?: string; serial_number: string }>;
}

export interface SecretCacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Base class with caching support
 */
export abstract class CachedSecretManager implements SecretManager {
  protected cache = new Map<string, SecretCacheEntry>();
  protected ttlMs: number;

  constructor(ttlSeconds = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  abstract fetchSecret(key: string): Promise<string | undefined>;

  async getSecret(key: string): Promise<string | undefined> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.fetchSecret(key);
    if (value !== undefined) {
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.ttlMs,
      });
    }
    return value;
  }
}

/**
 * HashiCorp Vault Implementation
 */
export class VaultSecretManager extends CachedSecretManager {
  private client: vault.client;
  private mountPath: string;

  constructor(options: { 
    address: string; 
    token?: string; 
    mountPath?: string;
    ttl?: number;
  }) {
    super(options.ttl);
    this.client = vault({
      apiVersion: 'v1',
      endpoint: options.address,
      ...(options.token && { token: options.token }),
    });
    this.mountPath = options.mountPath || 'secret';
  }

  async fetchSecret(key: string): Promise<string | undefined> {
    try {
      // Key format: "path/to/secret:field" or just "secret" (default field 'value')
      const [secretPath, field = 'value'] = key.includes(':') ? key.split(':') : [key, 'value'];
      const fullPath = `${this.mountPath}/data/${secretPath}`;
      const result = await this.client.read(fullPath);
      // Vault KV v2 structure: data.data[field]
      return result?.data?.data?.[field];
    } catch (error) {
      console.error(`[Vault] Error reading secret ${key}:`, (error as Error).message);
      return undefined;
    }
  }

  async issueCertificate(role: string, commonName: string, ttl?: string): Promise<{ certificate: string; private_key?: string; serial_number: string }> {
    // Vault PKI endpoint: /v1/{mountPath}/issue/{role}
    // The client.write method expects the full path without leading '/v1/'
    const path = `${this.mountPath}/issue/${role}`;
    const params: any = { common_name: commonName };
    if (ttl) {params.ttl = ttl;}
    try {
      const result = await this.client.write(path, params);
      // Expected response structure: { data: { certificate: string, private_key?: string, serial_number: string, ... } }
      const data = result?.data?.data || result?.data;
      return {
        certificate: data.certificate,
        private_key: data.private_key,
        serial_number: data.serial_number,
      };
    } catch (error) {
      console.error(`[Vault] Error issuing certificate for ${commonName} using role ${role}:`, (error as Error).message);
      throw error;
    }
  }
}

/**
 * Kubernetes Secret Volume Implementation
 */
export class K8sSecretManager extends CachedSecretManager {
  private secretsDir: string;

  constructor(secretsDir = '/var/run/secrets/edgecloud', ttl?: number) {
    super(ttl);
    this.secretsDir = secretsDir;
  }

  async fetchSecret(key: string): Promise<string | undefined> {
    try {
      const filePath = path.join(this.secretsDir, key);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim();
      }
      return undefined;
    } catch (error) {
      console.error(`[K8s] Error reading secret file ${key}:`, (error as Error).message);
      return undefined;
    }
  }
}

/**
 * Environment Variable Implementation (Fallback/Local)
 */
export class EnvSecretManager implements SecretManager {
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[key];
  }
}
