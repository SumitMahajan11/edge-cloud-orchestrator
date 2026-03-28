import { describe, it, expect } from 'vitest'
import { Validator, string, number, array, sanitize, validateInput } from '../validation'

describe('Validation', () => {
  describe('String validators', () => {
    it('should validate required strings', () => {
      const rule = string.required()
      expect(rule.validate('test')).toBe(true)
      expect(rule.validate('')).toBe(false)
      expect(rule.validate('   ')).toBe(false)
    })

    it('should validate min length', () => {
      const rule = string.minLength(3)
      expect(rule.validate('ab')).toBe(false)
      expect(rule.validate('abc')).toBe(true)
      expect(rule.validate('abcd')).toBe(true)
    })

    it('should validate max length', () => {
      const rule = string.maxLength(5)
      expect(rule.validate('abcdef')).toBe(false)
      expect(rule.validate('abcde')).toBe(true)
      expect(rule.validate('ab')).toBe(true)
    })

    it('should validate email format', () => {
      const rule = string.email()
      expect(rule.validate('test@example.com')).toBe(true)
      expect(rule.validate('invalid')).toBe(false)
      expect(rule.validate('test@')).toBe(false)
    })

    it('should validate URL format', () => {
      const rule = string.url()
      expect(rule.validate('https://example.com')).toBe(true)
      expect(rule.validate('http://localhost:3000')).toBe(true)
      expect(rule.validate('not-a-url')).toBe(false)
    })

    it('should validate pattern matches', () => {
      const rule = string.matches(/^[A-Z]{2}\d{4}$/)
      expect(rule.validate('AB1234')).toBe(true)
      expect(rule.validate('ab1234')).toBe(false)
    })

    it('should validate oneOf', () => {
      const rule = string.oneOf(['active', 'inactive', 'pending'])
      expect(rule.validate('active')).toBe(true)
      expect(rule.validate('unknown')).toBe(false)
    })
  })

  describe('Number validators', () => {
    it('should validate required numbers', () => {
      const rule = number.required()
      expect(rule.validate(42)).toBe(true)
      expect(rule.validate(0)).toBe(true)
      expect(rule.validate(NaN)).toBe(false)
    })

    it('should validate min value', () => {
      const rule = number.min(10)
      expect(rule.validate(5)).toBe(false)
      expect(rule.validate(10)).toBe(true)
      expect(rule.validate(15)).toBe(true)
    })

    it('should validate max value', () => {
      const rule = number.max(100)
      expect(rule.validate(150)).toBe(false)
      expect(rule.validate(100)).toBe(true)
      expect(rule.validate(50)).toBe(true)
    })

    it('should validate integer', () => {
      const rule = number.integer()
      expect(rule.validate(42)).toBe(true)
      expect(rule.validate(42.5)).toBe(false)
    })

    it('should validate positive', () => {
      const rule = number.positive()
      expect(rule.validate(1)).toBe(true)
      expect(rule.validate(0)).toBe(false)
      expect(rule.validate(-1)).toBe(false)
    })
  })

  describe('Array validators', () => {
    it('should validate required arrays', () => {
      const rule = array.required()
      expect(rule.validate([1, 2, 3])).toBe(true)
      expect(rule.validate([])).toBe(false)
    })

    it('should validate min length', () => {
      const rule = array.minLength(2)
      expect(rule.validate([1])).toBe(false)
      expect(rule.validate([1, 2])).toBe(true)
    })

    it('should validate max length', () => {
      const rule = array.maxLength(3)
      expect(rule.validate([1, 2, 3, 4])).toBe(false)
      expect(rule.validate([1, 2, 3])).toBe(true)
    })
  })

  describe('Validator class', () => {
    interface TestUser {
      name: string
      age: number
      email: string
    }

    it('should validate valid data', () => {
      const validator = new Validator<TestUser>({
        name: [string.required(), string.minLength(2)],
        age: [number.required(), number.min(0), number.max(150)],
        email: [string.required(), string.email()],
      })

      const result = validator.validate({
        name: 'John',
        age: 30,
        email: 'john@example.com',
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual({})
    })

    it('should return errors for invalid data', () => {
      const validator = new Validator<TestUser>({
        name: [string.required(), string.minLength(2)],
        age: [number.required(), number.min(0), number.max(150)],
        email: [string.required(), string.email()],
      })

      const result = validator.validate({
        name: 'J',
        age: -5,
        email: 'invalid',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.name).toBeDefined()
      expect(result.errors.age).toBeDefined()
      expect(result.errors.email).toBeDefined()
    })

    it('should validate single field', () => {
      const validator = new Validator<TestUser>({
        name: [string.required(), string.minLength(2)],
      })

      const errors = validator.validateField('name', 'J')
      expect(errors.length).toBeGreaterThan(0)

      const validErrors = validator.validateField('name', 'John')
      expect(validErrors.length).toBe(0)
    })
  })

  describe('Sanitization', () => {
    it('should sanitize strings', () => {
      expect(sanitize.string('  hello  ')).toBe('hello')
      expect(sanitize.string('<script>')).toBe('script')
    })

    it('should sanitize HTML', () => {
      expect(sanitize.html('<div>test</div>')).toBe('&lt;div&gt;test&lt;/div&gt;')
    })

    it('should sanitize email', () => {
      expect(sanitize.email('  TEST@EXAMPLE.COM  ')).toBe('test@example.com')
    })

    it('should sanitize URL', () => {
      expect(sanitize.url('https://example.com/path')).toBe('https://example.com/path')
      expect(sanitize.url('invalid')).toBe('')
    })
  })

  describe('validateInput helper', () => {
    interface LoginData {
      email: string
      password: string
    }

    it('should validate and return data', () => {
      const validate = validateInput<LoginData>({
        email: [string.required(), string.email()],
        password: [string.required(), string.minLength(8)],
      })

      const result = validate({
        email: 'test@example.com',
        password: 'password123',
      })

      expect(result.valid).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should return errors for invalid input', () => {
      const validate = validateInput<LoginData>({
        email: [string.required(), string.email()],
        password: [string.required(), string.minLength(8)],
      })

      const result = validate({
        email: 'invalid',
        password: 'short',
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it('should reject non-object input', () => {
      const validate = validateInput<LoginData>({
        email: [string.required()],
      })

      const result = validate(null)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Input must be an object')
    })
  })
})
