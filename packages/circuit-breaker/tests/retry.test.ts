import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryPolicy, RetryExhaustedError } from '../src/retry';

describe('RetryPolicy', () => {
  describe('default configuration', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = new RetryPolicy();
    });

    it('should use default values when constructed', async () => {
      // Test defaults by verifying behavior
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      
      try { await policy.execute(fn); } catch (e) {}
      
      // Default maxAttempts is 3
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('successful execution', () => {
    it('should return result on first success', async () => {
      const policy = new RetryPolicy();
      
      const result = await policy.execute(async () => 'success');
      
      expect(result).toBe('success');
    });

    it('should not retry on success', async () => {
      const policy = new RetryPolicy();
      const fn = vi.fn().mockResolvedValue('success');
      
      await policy.execute(fn);
      
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry behavior', () => {
    it('should retry on failure', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, initialDelay: 10 });
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');
      
      const result = await policy.execute(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw RetryExhaustedError after max attempts', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, initialDelay: 10 });
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      
      await expect(policy.execute(fn)).rejects.toThrow(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should include all errors in RetryExhaustedError', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, initialDelay: 10 });
      const fn = vi.fn().mockRejectedValue(new Error('test error'));
      
      try {
        await policy.execute(fn);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        if (error instanceof RetryExhaustedError) {
          expect(error.errors).toHaveLength(2);
          expect(error.errors[0].message).toBe('test error');
        }
      }
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay exponentially', async () => {
      vi.useFakeTimers();
      
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 1000,
      });
      
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const promise = policy.execute(fn);
      
      // First call happens immediately
      expect(fn).toHaveBeenCalledTimes(1);
      
      // Advance 100ms (first backoff)
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);
      
      // Advance 200ms (second backoff)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(3);
      
      const result = await promise;
      expect(result).toBe('success');
      
      vi.useRealTimers();
    });

    it('should cap delay at maxDelay', async () => {
      vi.useFakeTimers();
      
      const policy = new RetryPolicy({
        maxAttempts: 5,
        initialDelay: 1000,
        backoffMultiplier: 10,
        maxDelay: 5000,
      });
      
      const delays: number[] = [];
      const fn = vi.fn().mockImplementation(async () => {
        throw new Error('fail');
      });
      
      const onRetry = vi.fn((attempt, error, delay) => {
        delays.push(delay);
      });
      
      const policyWithCallback = new RetryPolicy({
        maxAttempts: 5,
        initialDelay: 1000,
        backoffMultiplier: 10,
        maxDelay: 5000,
        onRetry,
      });
      
      try {
        await policyWithCallback.execute(fn);
      } catch (e) {}
      
      // Delays should be capped at maxDelay
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(5000);
      });
      
      vi.useRealTimers();
    });
  });

  describe('retryable errors filter', () => {
    it('should only retry specified errors', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: ['NetworkError', 'TimeoutError'],
      });
      
      class NetworkError extends Error {
        constructor() {
          super('network error');
          this.name = 'NetworkError';
        }
      }
      
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError())
        .mockResolvedValue('success');
      
      const result = await policy.execute(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: ['NetworkError'],
      });
      
      const fn = vi.fn().mockRejectedValue(new Error('OtherError'));
      
      await expect(policy.execute(fn)).rejects.toThrow('OtherError');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('events', () => {
    it('should emit retry events', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, initialDelay: 10 });
      const retryEvents: any[] = [];
      
      policy.on('retry', (data) => retryEvents.push(data));
      
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      await policy.execute(fn);
      
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0].attempt).toBe(1);
      expect(retryEvents[0].error.message).toBe('fail');
    });
  });
});
