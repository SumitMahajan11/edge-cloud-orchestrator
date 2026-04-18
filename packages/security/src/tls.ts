import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'shared-tls-factory' });

export interface MtlsOptions {
  certPath: string;
  keyPath: string;
  caPath: string;
  serviceName: string;
}

/**
 * Validates that the certificate and key are present, valid, and not nearing expiry.
 */
function validateCerts(options: MtlsOptions): { cert: Buffer; key: Buffer; ca: Buffer } {
  const { certPath, keyPath, caPath } = options;

  if (!fs.existsSync(certPath)) throw new Error(`Cert file not found: ${certPath}`);
  if (!fs.existsSync(keyPath)) throw new Error(`Key file not found: ${keyPath}`);
  if (!fs.existsSync(caPath)) throw new Error(`CA file not found: ${caPath}`);

  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);
  const ca = fs.readFileSync(caPath);

  // Expiry check
  const x509 = new crypto.X509Certificate(cert);
  const validTo = new Date(x509.validTo);
  const now = new Date();
  const diffDays = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 7) {
    throw new Error(`FATAL: Certificate for ${options.serviceName} expires in ${diffDays} days! Refusing to start.`);
  }

  return { cert, key, ca };
}

/**
 * Creates HTTPS Server options for mandatory mTLS.
 */
export function createMtlsServer(options: MtlsOptions): https.ServerOptions {
  const { cert, key, ca } = validateCerts(options);

  return {
    cert,
    key,
    ca,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
    // Custom authorization callback to log rejections
    SNICallback: (servername, cb) => {
      // Logic could be added here if multiple certs are used
      cb(null);
    }
  };
}

/**
 * Creates an HTTPS Agent for outgoing mTLS requests.
 */
export function createMtlsAgent(options: MtlsOptions): https.Agent {
  const { cert, key, ca } = validateCerts(options);

  return new https.Agent({
    cert,
    key,
    ca,
    rejectUnauthorized: true,
  });
}

/**
 * Middleware or helper to validate client certificate CN pattern.
 */
export function validateClientCertificate(cert: any, expectedPattern: RegExp): boolean {
  if (!cert || !cert.subject) return false;
  const cn = cert.subject.CN;
  if (!cn) return false;
  
  const isValid = expectedPattern.test(cn);
  if (!isValid) {
    logger.error(`Unauthorized client certificate CN: ${cn}. Expected pattern: ${expectedPattern}`);
  }
  return isValid;
}
