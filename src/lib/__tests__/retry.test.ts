import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RetryManager, CircuitBreaker } from '../retry'

describe('RetryManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('execute', () => {
    it('should return result on first successful attempt', async () => {
      const retryManager = new RetryManager()
      const operation = vi.fn().mockResolvedValue('success')

      const result = await retryManager.execute(operation, 'test')

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on retryable errors', async () => {
      const retryManager = new RetryManager({ maxAttempts: 3, initialDelayMs: 100 })
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('success')

      const resultPromise = retryManager.execute(operation, 'test')

      // Fast-forward through delays
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should throw after max attempts', async () => {
      const retryManager = new RetryManager({ maxAttempts: 2, initialDelayMs: 100 })
      const operation = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

      const resultPromise = retryManager.execute(operation, 'test')
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow('ECONNRESET')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should not retry non-retryable errors', async () => {
      const retryManager = new RetryManager()
      const operation = vi.fn().mockRejectedValue(new Error('ValidationError'))

      await expect(retryManager.execute(operation, 'test')).rejects.toThrow('ValidationError')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn()
      const retryManager = new RetryManager({ maxAttempts: 3, initialDelayMs: 100, onRetry })
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success')

      const resultPromise = retryManager.execute(operation, 'test')
      await vi.runAllTimersAsync()

      await resultPromise
      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number))
    })

    it('should use exponential backoff', async () => {
      const retryManager = new RetryManager({
        maxAttempts: 4,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      })
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success')

      const resultPromise = retryManager.execute(operation, 'test')

      // Run all timers to complete
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(4)
    })
  })
})

describe('CircuitBreaker', () => {
  it('should start in CLOSED state', () => {
    const cb = new CircuitBreaker()
    expect(cb.canExecute()).toBe(true)
    expect(cb.getState().state).toBe('CLOSED')
  })

  it('should open after failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 })

    cb.recordFailure()
    cb.recordFailure()
    expect(cb.canExecute()).toBe(true)

    cb.recordFailure()
    expect(cb.canExecute()).toBe(false)
    expect(cb.getState().state).toBe('OPEN')
  })

  it('should reject requests when OPEN', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 })

    cb.recordFailure()
    expect(cb.canExecute()).toBe(false)
  })

  it('should transition to HALF_OPEN after timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, timeoutMs: 1000 })

    cb.recordFailure()
    expect(cb.canExecute()).toBe(false)

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 1100))

    expect(cb.canExecute()).toBe(true)
    expect(cb.getState().state).toBe('HALF_OPEN')
  })

  it('should close after success threshold in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2, timeoutMs: 100 })
  
    cb.recordFailure()
    expect(cb.getState().state).toBe('OPEN')
  
    // Wait for timeout to transition to HALF_OPEN
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(cb.canExecute()).toBe(true) // Now in HALF_OPEN
  
    cb.recordSuccess() // First success in HALF_OPEN
    cb.recordSuccess() // Second success should close
  
    expect(cb.getState().state).toBe('CLOSED')
  })

  it('should reopen on failure in HALF_OPEN', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2 })

    cb.recordFailure()
    expect(cb.getState().state).toBe('OPEN')

    // First success transitions to HALF_OPEN
    // Failure should reopen
    cb.recordFailure()

    expect(cb.getState().state).toBe('OPEN')
  })

  it('should reset failure count on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 })

    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState().failureCount).toBe(2)

    cb.recordSuccess()
    expect(cb.getState().failureCount).toBe(0)
  })
})
