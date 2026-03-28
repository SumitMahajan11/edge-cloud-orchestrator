import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'eventemitter3';

export interface VaultConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  tls?: {
    cert?: string;
    key?: string;
    ca?: string;
  };
}

export interface DatabaseCredentials {
  username: string;
  password: string;
  leaseId: string;
  leaseDuration: number;
  renewable: boolean;
}

export interface CertificateResponse {
  certificate: string;
  issuingCa: string;
  caChain: string[];
  privateKey: string;
  privateKeyType: string;
  serialNumber: string;
  leaseId: string;
  leaseDuration: number;
}

export class VaultClient extends EventEmitter {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenRenewalTimer: NodeJS.Timeout | null = null;
  private config: VaultConfig;

  constructor(config: VaultConfig) {
    super();
    this.config = config;
    this.client = axios.create({
      baseURL: config.address,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Setup request interceptor for token
    this.client.interceptors.request.use(async (config) => {
      if (this.token) {
        config.headers['X-Vault-Token'] = this.token;
      }
      return config;
    });
  }

  async authenticate(): Promise<void> {
    if (this.config.token) {
      this.token = this.config.token;
      await this.validateToken();
    } else if (this.config.roleId && this.config.secretId) {
      await this.authenticateAppRole();
    } else {
      throw new Error('No authentication method provided');
    }

    this.scheduleTokenRenewal();
    this.emit('authenticated');
  }

  private async validateToken(): Promise<void> {
    try {
      await this.client.get('/v1/auth/token/lookup-self');
    } catch (error) {
      throw new Error('Invalid Vault token');
    }
  }

  private async authenticateAppRole(): Promise<void> {
    const response = await this.client.post('/v1/auth/approle/login', {
      role_id: this.config.roleId,
      secret_id: this.config.secretId,
    });

    this.token = response.data.auth.client_token;
    this.emit('tokenReceived', {
      token: this.token,
      leaseDuration: response.data.auth.lease_duration,
      renewable: response.data.auth.renewable,
    });
  }

  private scheduleTokenRenewal(): void {
    if (this.tokenRenewalTimer) {
      clearTimeout(this.tokenRenewalTimer);
    }

    // Renew token at 2/3 of its TTL
    const renewalInterval = 20 * 60 * 1000; // 20 minutes default

    this.tokenRenewalTimer = setTimeout(async () => {
      try {
        await this.renewToken();
      } catch (error) {
        this.emit('renewalFailed', error);
        // Re-authenticate
        await this.authenticate();
      }
    }, renewalInterval);
  }

  private async renewToken(): Promise<void> {
    const response = await this.client.post('/v1/auth/token/renew-self');
    this.emit('tokenRenewed', {
      leaseDuration: response.data.auth.lease_duration,
    });
  }

  // KV Secrets Engine v2
  async getSecret(path: string): Promise<Record<string, any>> {
    const response = await this.client.get(`/v1/secret/data/${path}`);
    return response.data.data.data;
  }

  async putSecret(path: string, data: Record<string, any>): Promise<void> {
    await this.client.post(`/v1/secret/data/${path}`, {
      data,
    });
  }

  // Database Secrets Engine
  async getDatabaseCredentials(role: string): Promise<DatabaseCredentials> {
    const response = await this.client.get(`/v1/database/creds/${role}`);
    const data = response.data.data;

    const creds: DatabaseCredentials = {
      username: data.username,
      password: data.password,
      leaseId: response.data.lease_id,
      leaseDuration: response.data.lease_duration,
      renewable: response.data.renewable,
    };

    // Schedule automatic renewal if renewable
    if (creds.renewable) {
      this.scheduleLeaseRenewal(creds.leaseId, creds.leaseDuration);
    }

    return creds;
  }

  private scheduleLeaseRenewal(leaseId: string, leaseDuration: number): void {
    const renewalTime = (leaseDuration * 1000 * 2) / 3; // Renew at 2/3 TTL

    setTimeout(async () => {
      try {
        await this.renewLease(leaseId);
      } catch (error) {
        this.emit('leaseRenewalFailed', { leaseId, error });
      }
    }, renewalTime);
  }

  async renewLease(leaseId: string): Promise<void> {
    await this.client.put('/v1/sys/leases/renew', {
      lease_id: leaseId,
    });
    this.emit('leaseRenewed', { leaseId });
  }

  async revokeLease(leaseId: string): Promise<void> {
    await this.client.put('/v1/sys/leases/revoke', {
      lease_id: leaseId,
    });
  }

  // PKI Secrets Engine
  async generateCertificate(
    role: string,
    commonName: string,
    options?: {
      ttl?: string;
      altNames?: string[];
      ipSans?: string[];
    }
  ): Promise<CertificateResponse> {
    const response = await this.client.post(`/v1/pki_int/issue/${role}`, {
      common_name: commonName,
      ttl: options?.ttl,
      alt_names: options?.altNames?.join(','),
      ip_sans: options?.ipSans?.join(','),
    });

    const data = response.data.data;
    return {
      certificate: data.certificate,
      issuingCa: data.issuing_ca,
      caChain: data.ca_chain,
      privateKey: data.private_key,
      privateKeyType: data.private_key_type,
      serialNumber: data.serial_number,
      leaseId: response.data.lease_id,
      leaseDuration: response.data.lease_duration,
    };
  }

  async revokeCertificate(serialNumber: string): Promise<void> {
    await this.client.post('/v1/pki_int/revoke', {
      serial_number: serialNumber,
    });
  }

  // Health check
  async healthCheck(): Promise<{
    initialized: boolean;
    sealed: boolean;
    standby: boolean;
  }> {
    const response = await this.client.get('/v1/sys/health');
    return {
      initialized: response.data.initialized,
      sealed: response.data.sealed,
      standby: response.data.standby,
    };
  }

  async close(): Promise<void> {
    if (this.tokenRenewalTimer) {
      clearTimeout(this.tokenRenewalTimer);
    }
  }
}
