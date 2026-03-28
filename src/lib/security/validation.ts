type ValidatorFn = (value: unknown) => { valid: boolean; error?: string }

interface ValidationSchema {
  [key: string]: ValidatorFn | ValidationSchema
}

interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
  sanitized: Record<string, unknown>
}

class InputValidator {
  // String validators
  static string(minLength = 0, maxLength = Infinity): ValidatorFn {
    return (value) => {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Must be a string' }
      }
      if (value.length < minLength) {
        return { valid: false, error: `Minimum length is ${minLength}` }
      }
      if (value.length > maxLength) {
        return { valid: false, error: `Maximum length is ${maxLength}` }
      }
      return { valid: true }
    }
  }

  static email(): ValidatorFn {
    return (value) => {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Must be a string' }
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(value)) {
        return { valid: false, error: 'Invalid email format' }
      }
      return { valid: true }
    }
  }

  static url(): ValidatorFn {
    return (value) => {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Must be a string' }
      }
      try {
        new URL(value)
        return { valid: true }
      } catch {
        return { valid: false, error: 'Invalid URL format' }
      }
    }
  }

  static regex(pattern: RegExp, message = 'Invalid format'): ValidatorFn {
    return (value) => {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Must be a string' }
      }
      if (!pattern.test(value)) {
        return { valid: false, error: message }
      }
      return { valid: true }
    }
  }

  // Number validators
  static number(min = -Infinity, max = Infinity): ValidatorFn {
    return (value) => {
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: 'Must be a number' }
      }
      if (value < min) {
        return { valid: false, error: `Minimum value is ${min}` }
      }
      if (value > max) {
        return { valid: false, error: `Maximum value is ${max}` }
      }
      return { valid: true }
    }
  }

  static integer(): ValidatorFn {
    return (value) => {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { valid: false, error: 'Must be an integer' }
      }
      return { valid: true }
    }
  }

  // Boolean validator
  static boolean(): ValidatorFn {
    return (value) => {
      if (typeof value !== 'boolean') {
        return { valid: false, error: 'Must be a boolean' }
      }
      return { valid: true }
    }
  }

  // Array validator
  static array(itemValidator?: ValidatorFn, minLength = 0, maxLength = Infinity): ValidatorFn {
    return (value) => {
      if (!Array.isArray(value)) {
        return { valid: false, error: 'Must be an array' }
      }
      if (value.length < minLength) {
        return { valid: false, error: `Minimum length is ${minLength}` }
      }
      if (value.length > maxLength) {
        return { valid: false, error: `Maximum length is ${maxLength}` }
      }
      if (itemValidator) {
        for (let i = 0; i < value.length; i++) {
          const result = itemValidator(value[i])
          if (!result.valid) {
            return { valid: false, error: `Item ${i}: ${result.error}` }
          }
        }
      }
      return { valid: true }
    }
  }

  // Object validator
  static object(schema: ValidationSchema): ValidatorFn {
    return (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { valid: false, error: 'Must be an object' }
      }

      const obj = value as Record<string, unknown>
      for (const [key, validator] of Object.entries(schema)) {
        if (typeof validator === 'function') {
          const result = validator(obj[key])
          if (!result.valid) {
            return { valid: false, error: `${key}: ${result.error}` }
          }
        }
      }

      return { valid: true }
    }
  }

  // Enum validator
  static enum<T extends string>(...values: T[]): ValidatorFn {
    return (value) => {
      if (!values.includes(value as T)) {
        return { valid: false, error: `Must be one of: ${values.join(', ')}` }
      }
      return { valid: true }
    }
  }

  // Optional validator
  static optional(validator: ValidatorFn): ValidatorFn {
    return (value) => {
      if (value === undefined || value === null) {
        return { valid: true }
      }
      return validator(value)
    }
  }

  // Combine validators
  static compose(...validators: ValidatorFn[]): ValidatorFn {
    return (value) => {
      for (const validator of validators) {
        const result = validator(value)
        if (!result.valid) {
          return result
        }
      }
      return { valid: true }
    }
  }
}

class InputSanitizer {
  // Sanitize HTML to prevent XSS
  static sanitizeHTML(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
  }

  // Remove script tags and event handlers
  static stripScripts(input: string): string {
    return input
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/javascript:/gi, '')
  }

  // Sanitize URL
  static sanitizeURL(url: string): string {
    const sanitized = url.trim()
    // Block javascript: and data: URLs
    if (/^(javascript|data|vbscript):/i.test(sanitized)) {
      return ''
    }
    return sanitized
  }

  // Trim and normalize whitespace
  static normalizeWhitespace(input: string): string {
    return input.trim().replace(/\s+/g, ' ')
  }

  // Remove control characters
  static removeControlChars(input: string): string {
    return input.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
  }

  // Sanitize object recursively
  static sanitizeObject(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.sanitizeHTML(this.stripScripts(this.normalizeWhitespace(obj)))
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item))
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeObject(value)
      }
      return sanitized
    }
    return obj
  }
}

class SchemaValidator {
  validate(data: unknown, schema: ValidationSchema): ValidationResult {
    const errors: Record<string, string> = {}
    const sanitized: Record<string, unknown> = {}

    if (typeof data !== 'object' || data === null) {
      return {
        valid: false,
        errors: { root: 'Data must be an object' },
        sanitized: {},
      }
    }

    const obj = data as Record<string, unknown>

    for (const [key, validator] of Object.entries(schema)) {
      if (typeof validator === 'function') {
        const result = validator(obj[key])
        if (!result.valid) {
          errors[key] = result.error || 'Invalid value'
        } else {
          // Sanitize string values
          const value = obj[key]
          if (typeof value === 'string') {
            sanitized[key] = InputSanitizer.sanitizeHTML(
              InputSanitizer.stripScripts(value)
            )
          } else {
            sanitized[key] = value
          }
        }
      } else if (typeof validator === 'object') {
        // Nested schema
        const nestedResult = this.validate(obj[key], validator)
        if (!nestedResult.valid) {
          Object.entries(nestedResult.errors).forEach(([nestedKey, error]) => {
            errors[`${key}.${nestedKey}`] = error
          })
        }
        sanitized[key] = nestedResult.sanitized
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      sanitized,
    }
  }
}

// Predefined schemas
const TaskSubmissionSchema = {
  name: InputValidator.compose(
    InputValidator.string(1, 100),
    InputValidator.regex(/^[\w\s-]+$/, 'Only alphanumeric, spaces, and hyphens allowed')
  ),
  type: InputValidator.enum(
    'Image Classification',
    'Data Aggregation',
    'Model Inference',
    'Sensor Fusion',
    'Video Processing',
    'Log Analysis',
    'Anomaly Detection'
  ),
  priority: InputValidator.enum('low', 'medium', 'high', 'critical'),
}

const NodeRegistrationSchema = {
  name: InputValidator.string(1, 50),
  url: InputValidator.compose(
    InputValidator.url(),
    InputValidator.string(1, 500)
  ),
  location: InputValidator.optional(InputValidator.string(0, 100)),
}

const WebhookConfigSchema = {
  name: InputValidator.string(1, 50),
  url: InputValidator.url(),
  events: InputValidator.array(InputValidator.string(1, 50), 1, 20),
  secret: InputValidator.optional(InputValidator.string(0, 256)),
}

// Export singleton
export const schemaValidator = new SchemaValidator()

export { InputValidator, InputSanitizer, SchemaValidator }
export { TaskSubmissionSchema, NodeRegistrationSchema, WebhookConfigSchema }
export type { ValidatorFn, ValidationSchema, ValidationResult }
