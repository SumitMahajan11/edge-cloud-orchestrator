import dns from 'dns/promises';

import { inRange,isIP } from 'range_check';

// Private and reserved IP ranges that must be blocked
const BLOCKED_CIDRS = [
  '10.0.0.0/8',       // RFC1918 private
  '172.16.0.0/12',    // RFC1918 private
  '192.168.0.0/16',   // RFC1918 private
  '127.0.0.0/8',      // Loopback
  '169.254.0.0/16',   // Link-local (AWS metadata!)
  '::1/128',          // IPv6 loopback
  'fc00::/7',         // IPv6 private
  '0.0.0.0/8',        // This network
  '100.64.0.0/10',    // Shared address space
  '198.18.0.0/15',    // Benchmarking
  '240.0.0.0/4',      // Reserved
];

/**
 * Checks if an IP address belongs to a private or reserved range.
 */
export function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) {return false;}
  return inRange(ip, BLOCKED_CIDRS);
}

/**
 * Validates an IP address for SSRF protection.
 */
export function validateIpAddress(ip: string): { safe: boolean; reason?: string } {
  if (!isIP(ip)) {
    return { safe: false, reason: 'Invalid IP address' };
  }
  if (process.env.ALLOW_PRIVATE_IPS !== 'true' && process.env.NODE_ENV !== 'development' && isPrivateIp(ip)) {
    return { safe: false, reason: 'Private or reserved IP address blocked' };
  }
  return { safe: true };
}

/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Blocks private IP ranges and enforces protocol restrictions.
 */
export async function validateWebhookUrl(urlString: string): Promise<{
  safe: boolean;
  reason?: string;
}> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }
  
  // Only allow HTTPS in production
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    return { safe: false, reason: 'Only HTTPS webhooks allowed in production' };
  }
  
  // Block non-HTTP protocols
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { safe: false, reason: `Protocol ${url.protocol} not allowed` };
  }
  
  // Block if hostname is already an IP address
  if (isIP(url.hostname)) {
    if (process.env.ALLOW_PRIVATE_IPS !== 'true' && process.env.NODE_ENV !== 'development' && isPrivateIp(url.hostname)) {
      return { safe: false, reason: 'Webhook URL resolves to a private IP address' };
    }
  }
  
  // DNS resolution check (prevents DNS rebinding attacks)
  if (process.env.ALLOW_PRIVATE_IPS !== 'true' && process.env.NODE_ENV !== 'development') {
    try {
      const addresses = await dns.lookup(url.hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          return {
            safe: false,
            reason: `Webhook URL resolves to private IP: ${addr.address}`
          };
        }
      }
    } catch (err) {
      // If we can't resolve it, we can't guarantee it's safe
      return { safe: false, reason: 'Could not resolve webhook hostname' };
    }
  }
  
  return { safe: true };
}
