import { logger } from './logger'

// Validation schemas
interface ValidationRule<T> {
  validate: (value: T) => boolean
  message: string
}

type Schema<T> = {
  [K in keyof T]?: ValidationRule<T[K]>[]
}

// String validators
export const string = {
  required: (message = 'Field is required'): ValidationRule<string> => ({
    validate: (value) => value !== undefined && value !== null && value.trim() !== '',
    message,
  }),
  minLength: (min: number, message = `Must be at least ${min} characters`): ValidationRule<string> => ({
    validate: (value) => value.length >= min,
    message,
  }),
  maxLength: (max: number, message = `Must be at most ${max} characters`): ValidationRule<string> => ({
    validate: (value) => value.length <= max,
    message,
  }),
  email: (message = 'Invalid email format'): ValidationRule<string> => ({
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message,
  }),
  url: (message = 'Invalid URL format'): ValidationRule<string> => ({
    validate: (value) => {
      try {
        new URL(value)
        return true
      } catch {
        return false
      }
    },
    message,
  }),
  matches: (pattern: RegExp, message = 'Invalid format'): ValidationRule<string> => ({
    validate: (value) => pattern.test(value),
    message,
  }),
  oneOf: (values: string[], message = `Must be one of: ${values.join(', ')}`): ValidationRule<string> => ({
    validate: (value) => values.includes(value),
    message,
  }),
}

// Number validators
export const number = {
  required: (message = 'Field is required'): ValidationRule<number> => ({
    validate: (value) => value !== undefined && value !== null && !isNaN(value),
    message,
  }),
  min: (min: number, message = `Must be at least ${min}`): ValidationRule<number> => ({
    validate: (value) => value >= min,
    message,
  }),
  max: (max: number, message = `Must be at most ${max}`): ValidationRule<number> => ({
    validate: (value) => value <= max,
    message,
  }),
  integer: (message = 'Must be an integer'): ValidationRule<number> => ({
    validate: (value) => Number.isInteger(value),
    message,
  }),
  positive: (message = 'Must be positive'): ValidationRule<number> => ({
    validate: (value) => value > 0,
    message,
  }),
}

// Array validators
export const array = {
  required: (message = 'Field is required'): ValidationRule<unknown[]> => ({
    validate: (value) => Array.isArray(value) && value.length > 0,
    message,
  }),
  minLength: (min: number, message = `Must have at least ${min} items`): ValidationRule<unknown[]> => ({
    validate: (value) => value.length >= min,
    message,
  }),
  maxLength: (max: number, message = `Must have at most ${max} items`): ValidationRule<unknown[]> => ({
    validate: (value) => value.length <= max,
    message,
  }),
}

// Object validators
export const object = {
  required: (message = 'Field is required'): ValidationRule<Record<string, unknown>> => ({
    validate: (value) => value !== undefined && value !== null && typeof value === 'object',
    message,
  }),
}

// Validation result
interface ValidationResult<T> {
  valid: boolean
  errors: Partial<Record<keyof T, string[]>>
}

// Validator class
class Validator<T> {
  private schema: Schema<T>

  constructor(schema: Schema<T>) {
    this.schema = schema
  }

  validate(data: Partial<T>): ValidationResult<T> {
    const errors: Partial<Record<keyof T, string[]>> = {}

    for (const [key, rules] of Object.entries(this.schema) as [keyof T, ValidationRule<T[keyof T]>[]][]) {
      const value = data[key]
      const fieldErrors: string[] = []

      for (const rule of rules) {
        if (!rule.validate(value as T[keyof T])) {
          fieldErrors.push(rule.message)
        }
      }

      if (fieldErrors.length > 0) {
        errors[key] = fieldErrors
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    }
  }

  validateField<K extends keyof T>(key: K, value: T[K]): string[] {
    const rules = this.schema[key]
    if (!rules) return []

    return rules
      .filter(rule => !rule.validate(value))
      .map(rule => rule.message)
  }
}

// Sanitization functions
export const sanitize = {
  string: (value: string): string => {
    return value
      .trim()
      .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  },

  html: (value: string): string => {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  },

  sql: (value: string): string => {
    // Basic SQL injection prevention
    return value
      .replace(/'/g, "''")
      .replace(/;/g, '')
      .replace(/--/g, '')
      .replace(/\/\*/g, '')
      .replace(/\*\//g, '')
  },

  email: (value: string): string => {
    return value.toLowerCase().trim()
  },

  url: (value: string): string => {
    try {
      const url = new URL(value)
      return url.toString()
    } catch {
      return ''
    }
  },
}

// Input validation middleware
export function validateInput<T>(
  schema: Schema<T>
): (data: unknown) => { valid: boolean; data?: T; errors?: string[] } {
  const validator = new Validator<T>(schema)

  return (data: unknown) => {
    if (typeof data !== 'object' || data === null) {
      return { valid: false, errors: ['Input must be an object'] }
    }

    const result = validator.validate(data as Partial<T>)

    if (!result.valid) {
      const errors = Object.entries(result.errors).flatMap(([key, msgs]) =>
        ((msgs as string[] | undefined) ?? []).map((msg: string) => `${key}: ${msg}`)
      )
      logger.warn('Validation failed', { errors, data })
      return { valid: false, errors }
    }

    return { valid: true, data: data as T }
  }
}

// Common schemas
export const schemas = {
  task: {
    name: [string.required(), string.minLength(1), string.maxLength(100)],
    type: [string.required(), string.oneOf(['compute', 'storage', 'network', 'ml'])],
    priority: [number.required(), number.min(1), number.max(10)],
    target: [string.required()],
  },

  node: {
    name: [string.required(), string.minLength(1), string.maxLength(100)],
    location: [string.required()],
    url: [string.required(), string.url()],
  },

  policy: {
    name: [string.required(), string.minLength(1), string.maxLength(100)],
    type: [string.required(), string.oneOf(['routing', 'resource', 'security'])],
    rules: [array.required(), array.minLength(1)],
  },

  apiKey: {
    name: [string.required(), string.minLength(1), string.maxLength(100)],
    permissions: [array.required()],
  },
}

export { Validator }
export type { ValidationRule, Schema, ValidationResult }
