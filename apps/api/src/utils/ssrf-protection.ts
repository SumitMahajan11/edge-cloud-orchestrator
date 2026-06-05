import dns from 'dns/promises';
import { isIP, inRange } from 'range_check';

/**
 * SSRF Protection Utility
 *
 * Prevents requests to internal/private IP ranges.
 */
export class SSRFProtection {
  // Private IP ranges (IPv4 and IPv6)
  private static readonly PRIVATE_RANGES = [
    '127.0.0.0/8',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16', // Link-local
    '::1/128', // IPv6 Loopback
    'fc00::/7', // IPv6 Unique Local Address
    'fe80::/10', // IPv6 Link-local
  ];

  /**
   * Validates if a URL is safe to request (not pointing to internal infrastructure).
   *
   * @param urlStr The URL to validate
   * @returns true if safe, false if blocked
   */
  static async isSafeUrl(urlStr: string): Promise<boolean> {
    try {
      const url = new URL(urlStr);

      // 1. Block non-HTTP protocols
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
      }

      // 2. Resolve hostname to IPs
      const addresses = await dns.resolve(url.hostname).catch(() => {
        // If it's already an IP, it might fail resolve
        return [url.hostname];
      });

      // 3. Check each resolved IP
      for (const ip of addresses) {
        if (!isIP(ip)) {
          // If it's not a valid IP after resolution, it's suspicious or invalid
          continue;
        }

        if (inRange(ip, this.PRIVATE_RANGES)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
