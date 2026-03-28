interface IpFilterRule {
  id: string
  type: 'whitelist' | 'blacklist'
  ip: string
  description?: string
  createdAt: number
  expiresAt?: number
}

interface IpFilterConfig {
  defaultAction?: 'allow' | 'deny'
  checkHeaders?: string[]
}

class IpFilter {
  private rules: Map<string, IpFilterRule> = new Map()
  private whitelist: Set<string> = new Set()
  private blacklist: Set<string> = new Set()
  private config: Required<IpFilterConfig>

  constructor(config: IpFilterConfig = {}) {
    this.config = {
      defaultAction: 'allow',
      checkHeaders: ['X-Forwarded-For', 'X-Real-IP'],
      ...config,
    }
  }

  // Parse IP with optional CIDR notation
  private parseIp(ip: string): { address: string; mask?: number } {
    if (ip.includes('/')) {
      const [address, maskStr] = ip.split('/')
      return { address, mask: parseInt(maskStr, 10) }
    }
    return { address: ip }
  }

  // Check if IP matches CIDR range
  private ipInCidr(ip: string, cidr: string): boolean {
    const { address: network, mask } = this.parseIp(cidr)
    if (!mask) {
      return ip === network
    }

    const ipNum = this.ipToNumber(ip)
    const networkNum = this.ipToNumber(network)
    const maskNum = -1 << (32 - mask)

    return (ipNum & maskNum) === (networkNum & maskNum)
  }

  private ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  }

  addWhitelist(ip: string, description?: string, expiresAt?: number): string {
    const id = `wl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const rule: IpFilterRule = {
      id,
      type: 'whitelist',
      ip,
      description,
      createdAt: Date.now(),
      expiresAt,
    }

    this.rules.set(id, rule)
    this.whitelist.add(ip)

    return id
  }

  addBlacklist(ip: string, description?: string, expiresAt?: number): string {
    const id = `bl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const rule: IpFilterRule = {
      id,
      type: 'blacklist',
      ip,
      description,
      createdAt: Date.now(),
      expiresAt,
    }

    this.rules.set(id, rule)
    this.blacklist.add(ip)

    return id
  }

  removeRule(id: string): boolean {
    const rule = this.rules.get(id)
    if (!rule) return false

    if (rule.type === 'whitelist') {
      this.whitelist.delete(rule.ip)
    } else {
      this.blacklist.delete(rule.ip)
    }

    return this.rules.delete(id)
  }

  // Extract client IP from request
  getClientIp(req: Request): string | null {
    // Check custom headers first (for proxies)
    for (const header of this.config.checkHeaders) {
      const value = req.headers.get(header)
      if (value) {
        // X-Forwarded-For can contain multiple IPs, take the first one
        const ips = value.split(',').map(ip => ip.trim())
        if (ips.length > 0) {
          return ips[0]
        }
      }
    }

    // Try to get from connection info (would need server-specific implementation)
    // This is a placeholder - in real implementation, get from socket
    return null
  }

  check(ip: string): { allowed: boolean; reason?: string } {
    const now = Date.now()

    // Check blacklist first (takes precedence)
    for (const rule of this.rules.values()) {
      if (rule.type !== 'blacklist') continue
      if (rule.expiresAt && now > rule.expiresAt) continue

      if (this.ipMatches(ip, rule.ip)) {
        return {
          allowed: false,
          reason: `IP ${ip} is blacklisted${rule.description ? `: ${rule.description}` : ''}`,
        }
      }
    }

    // Check whitelist (if any whitelist rules exist)
    if (this.whitelist.size > 0) {
      let whitelisted = false
      for (const rule of this.rules.values()) {
        if (rule.type !== 'whitelist') continue
        if (rule.expiresAt && now > rule.expiresAt) continue

        if (this.ipMatches(ip, rule.ip)) {
          whitelisted = true
          break
        }
      }

      if (!whitelisted) {
        return {
          allowed: false,
          reason: `IP ${ip} is not in whitelist`,
        }
      }
    }

    return { allowed: true }
  }

  private ipMatches(ip: string, ruleIp: string): boolean {
    if (ruleIp.includes('/')) {
      return this.ipInCidr(ip, ruleIp)
    }
    return ip === ruleIp
  }

  // Middleware for IP filtering
  middleware() {
    return async (req: Request): Promise<Response | null> => {
      const clientIp = this.getClientIp(req)

      if (!clientIp) {
        if (this.config.defaultAction === 'deny') {
          return new Response(JSON.stringify({ error: 'Could not determine client IP' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return null
      }

      const result = this.check(clientIp)

      if (!result.allowed) {
        return new Response(JSON.stringify({ error: result.reason }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return null // Continue to next handler
    }
  }

  // Rate limiting per IP
  private rateLimits: Map<string, { count: number; resetTime: number }> = new Map()

  checkRateLimit(ip: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now()
    const key = ip
    let limit = this.rateLimits.get(key)

    if (!limit || now > limit.resetTime) {
      limit = { count: 0, resetTime: now + windowMs }
      this.rateLimits.set(key, limit)
    }

    if (limit.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: limit.resetTime,
      }
    }

    limit.count++

    return {
      allowed: true,
      remaining: maxRequests - limit.count,
      resetTime: limit.resetTime,
    }
  }

  // Cleanup expired rules and rate limits
  cleanup(): void {
    const now = Date.now()

    // Clean expired rules
    for (const [id, rule] of this.rules) {
      if (rule.expiresAt && now > rule.expiresAt) {
        this.removeRule(id)
      }
    }

    // Clean expired rate limits
    for (const [ip, limit] of this.rateLimits) {
      if (now > limit.resetTime) {
        this.rateLimits.delete(ip)
      }
    }
  }

  getStats(): {
    totalRules: number
    whitelistRules: number
    blacklistRules: number
    activeRateLimits: number
  } {
    let whitelistRules = 0
    let blacklistRules = 0

    for (const rule of this.rules.values()) {
      if (rule.type === 'whitelist') {
        whitelistRules++
      } else {
        blacklistRules++
      }
    }

    return {
      totalRules: this.rules.size,
      whitelistRules,
      blacklistRules,
      activeRateLimits: this.rateLimits.size,
    }
  }

  listRules(): IpFilterRule[] {
    return Array.from(this.rules.values())
  }
}

// Singleton instance
export const ipFilter = new IpFilter()

export { IpFilter }
export type { IpFilterRule, IpFilterConfig }
