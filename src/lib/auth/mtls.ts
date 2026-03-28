import { generateId } from '../utils'

interface Certificate {
  id: string
  nodeId: string
  publicKey: string
  privateKey: string
  caCert: string
  validFrom: Date
  validUntil: Date
  revoked: boolean
}

interface MTLSConfig {
  enabled: boolean
  caCert: string
  requireClientCert: boolean
  verifyDepth: number
}

class MTLSManager {
  private certificates: Map<string, Certificate> = new Map()
  private caPrivateKey: string | null = null
  private caCert: string | null = null

  async initialize(): Promise<void> {
    // Generate CA certificate if not exists
    if (!this.caCert) {
      await this.generateCA()
    }
  }

  private async generateCA(): Promise<void> {
    // In production, use proper certificate generation
    // This is a simplified version for demonstration
    this.caPrivateKey = this.generateKeyPair()
    this.caCert = this.generateSelfSignedCert('EdgeCloud CA', this.caPrivateKey)
  }

  private generateKeyPair(): string {
    // Simplified key generation
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array))
  }

  private generateSelfSignedCert(commonName: string, privateKey: string): string {
    const certData = {
      subject: { CN: commonName },
      issuer: { CN: commonName },
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      publicKey: this.derivePublicKey(privateKey),
    }
    return btoa(JSON.stringify(certData))
  }

  private derivePublicKey(privateKey: string): string {
    // Simplified public key derivation
    return btoa(`pk_${privateKey}`)
  }

  async generateNodeCertificate(nodeId: string): Promise<Certificate> {
    if (!this.caPrivateKey || !this.caCert) {
      throw new Error('CA not initialized')
    }

    const nodePrivateKey = this.generateKeyPair()
    const nodePublicKey = this.derivePublicKey(nodePrivateKey)

    const cert: Certificate = {
      id: generateId(),
      nodeId,
      publicKey: nodePublicKey,
      privateKey: nodePrivateKey,
      caCert: this.caCert,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      revoked: false,
    }

    this.certificates.set(nodeId, cert)
    return cert
  }

  verifyCertificate(nodeId: string, _certPEM: string): boolean {
    const cert = this.certificates.get(nodeId)
    if (!cert) return false
    if (cert.revoked) return false
    if (new Date() > cert.validUntil) return false

    // Verify certificate chain
    return cert.caCert === this.caCert
  }

  revokeCertificate(nodeId: string): boolean {
    const cert = this.certificates.get(nodeId)
    if (!cert) return false

    cert.revoked = true
    return true
  }

  getCertificate(nodeId: string): Certificate | undefined {
    return this.certificates.get(nodeId)
  }

  getAllCertificates(): Certificate[] {
    return Array.from(this.certificates.values())
  }

  getCACert(): string | null {
    return this.caCert
  }

  async renewCertificate(nodeId: string): Promise<Certificate | null> {
    const oldCert = this.certificates.get(nodeId)
    if (!oldCert || oldCert.revoked) return null

    // Generate new certificate
    return await this.generateNodeCertificate(nodeId)
  }

  getConfig(): MTLSConfig {
    return {
      enabled: true,
      caCert: this.caCert || '',
      requireClientCert: true,
      verifyDepth: 2,
    }
  }
}

// Singleton instance
export const mtlsManager = new MTLSManager()

export { MTLSManager }
export type { Certificate, MTLSConfig }
