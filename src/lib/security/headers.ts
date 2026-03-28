interface SecurityHeaders {
  'Content-Security-Policy': string
  'X-Content-Type-Options': string
  'X-Frame-Options': string
  'X-XSS-Protection': string
  'Strict-Transport-Security': string
  'Referrer-Policy': string
  'Permissions-Policy': string
}

const DEFAULT_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'ws:', 'wss:'],
  'media-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

class SecurityHeadersManager {
  private headers: SecurityHeaders
  private csp: Record<string, string[]>

  constructor() {
    this.csp = { ...DEFAULT_CSP }
    this.headers = this.buildHeaders()
  }

  private buildCSP(): string {
    return Object.entries(this.csp)
      .map(([key, values]) => `${key} ${values.join(' ')}`)
      .join('; ')
  }

  private buildHeaders(): SecurityHeaders {
    return {
      'Content-Security-Policy': this.buildCSP(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()',
    }
  }

  getHeaders(): SecurityHeaders {
    return { ...this.headers }
  }

  getCSP(): string {
    return this.headers['Content-Security-Policy']
  }

  addCSPSource(directive: keyof typeof DEFAULT_CSP, source: string): void {
    if (!this.csp[directive]) {
      this.csp[directive] = []
    }
    if (!this.csp[directive].includes(source)) {
      this.csp[directive].push(source)
    }
    this.headers = this.buildHeaders()
  }

  removeCSPSource(directive: keyof typeof DEFAULT_CSP, source: string): void {
    if (this.csp[directive]) {
      this.csp[directive] = this.csp[directive].filter(s => s !== source)
      this.headers = this.buildHeaders()
    }
  }

  setCSPDirectives(directives: Partial<typeof DEFAULT_CSP>): void {
    this.csp = { ...this.csp, ...directives }
    this.headers = this.buildHeaders()
  }

  // For development mode (less strict)
  setDevelopmentMode(): void {
    this.csp = {
      ...DEFAULT_CSP,
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'connect-src': ["'self'", 'ws:', 'wss:', 'http://localhost:*', 'https://localhost:*'],
    }
    this.headers = this.buildHeaders()
  }

  // For production mode (strict)
  setProductionMode(): void {
    this.csp = { ...DEFAULT_CSP }
    this.headers = this.buildHeaders()
  }

  // Generate meta tag for CSP (for HTML)
  generateMetaTag(): string {
    return `<meta http-equiv="Content-Security-Policy" content="${this.buildCSP()}">`
  }

  // Apply headers to fetch request
  applyToRequest(init: RequestInit = {}): RequestInit {
    return {
      ...init,
      headers: {
        ...init.headers,
        ...this.headers,
      },
    }
  }

  // Validate if URL is allowed by CSP
  isURLAllowed(url: string, directive: keyof typeof DEFAULT_CSP = 'connect-src'): boolean {
    try {
      const parsed = new URL(url)
      const sources = this.csp[directive] || []

      for (const source of sources) {
        if (source === "'self'") {
          if (parsed.hostname === window.location.hostname) return true
        } else if (source === '*') {
          return true
        } else if (source.startsWith('http')) {
          const sourceURL = new URL(source)
          if (parsed.hostname === sourceURL.hostname) return true
        } else if (source.includes(':')) {
          if (parsed.protocol === source) return true
        }
      }

      return false
    } catch {
      return false
    }
  }

  getReport(): {
    headers: SecurityHeaders
    csp: Record<string, string[]>
    score: number
    recommendations: string[]
  } {
    const recommendations: string[] = []
    let score = 100

    // Check for unsafe directives
    if (this.csp['script-src']?.includes("'unsafe-inline'")) {
      score -= 10
      recommendations.push("Remove 'unsafe-inline' from script-src for better security")
    }
    if (this.csp['script-src']?.includes("'unsafe-eval'")) {
      score -= 10
      recommendations.push("Remove 'unsafe-eval' from script-src for better security")
    }

    // Check for missing directives
    if (!this.headers['Strict-Transport-Security']) {
      score -= 15
      recommendations.push("Add HSTS header for HTTPS enforcement")
    }

    return {
      headers: this.headers,
      csp: this.csp,
      score,
      recommendations,
    }
  }
}

// Singleton instance
export const securityHeaders = new SecurityHeadersManager()

export { SecurityHeadersManager, DEFAULT_CSP }
export type { SecurityHeaders }
