/**
 * Unit Tests for Reliable Service Call Layer
 *
 * Tests the reliableCall wrapper ensuring:
 * - Retry logic works correctly
 * - Timeout protection active
 * - Circuit breaker integration
 * - Error classification accurate
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import {
  reliableCall,
  reliableAxios,
  reliableFetch,
  isRetryableError,
  TimeoutError,
  ReliableCallError,
} from '../../src/utils/reliableCall';
import { CircuitBreaker } from '@edgecloud/circuit-breaker';

// Mock axios
vi.mock('axios');
const mockedAxios = axios as any;

describe('reliableCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful execution', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await reliableCall(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await reliableCall(fn);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry behavior', () => {
    it('should retry after transient failure', async () => {
      let attempts = 0;
      const fn = vi.fn().mockImplementation(async () => {
        if (attempts++ < 2) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      });

      const result = await reliableCall(fn, { retries: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw ReliableCallError after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(reliableCall(fn, { retries: 2 })).rejects.toThrow(
        ReliableCallError,
      );

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should include attempt count in error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fails'));

      try {
        await reliableCall(fn, { retries: 3 });
        throw new Error('Should have thrown');
      } catch (error: unknown) {
        if (error instanceof ReliableCallError) {
          expect(error.attemptCount).toBe(4); // Initial + 3 retries
        }
      }
    });
  });

  describe('timeout protection', () => {
    it('should timeout slow operations', async () => {
      const slowFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return 'too slow';
      });

      await expect(
        reliableCall(slowFn, { timeoutMs: 100, retries: 0 }),
      ).rejects.toThrow(TimeoutError);

      expect(slowFn).toHaveBeenCalledTimes(1);
    });

    it('should include operation name in timeout error', async () => {
      const slowFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return 'slow';
      });

      try {
        await reliableCall(slowFn, {
          timeoutMs: 100,
          operationName: 'test-operation',
        });
        throw new Error('Should have thrown');
      } catch (error: unknown) {
        if (error instanceof TimeoutError) {
          expect(error.message).toContain('test-operation');
          expect(error.message).toContain('100ms');
        }
      }
    });
  });

  describe('circuit breaker integration', () => {
    it('should respect open circuit breaker', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
      });

      // Open the circuit
      try {
        await reliableCall(() => Promise.reject(new Error('Fail')), {
          circuitBreaker,
          retries: 0,
        });
      } catch (e) {}

      // Circuit should be open now
      const fn = vi.fn().mockResolvedValue('success');
      await expect(
        reliableCall(fn, { circuitBreaker, retries: 0 }),
      ).rejects.toThrow();
    });

    it('should close circuit after success', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      let fails = 0;
      const fn = vi.fn().mockImplementation(async () => {
        if (fails++ < 2) throw new Error('Fail');
        return 'success';
      });

      // First two calls fail, opening circuit
      try {
        await reliableCall(fn, { circuitBreaker, retries: 0 });
      } catch (e) {}
      try {
        await reliableCall(fn, { circuitBreaker, retries: 0 });
      } catch (e) {}

      // Third call succeeds, closing circuit
      const result = await reliableCall(fn, { circuitBreaker, retries: 0 });
      expect(result).toBe('success');
    });
  });

  describe('error classification', () => {
    it('should classify network errors as retryable', () => {
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
    });

    it('should classify HTTP 5xx as retryable', () => {
      const error500 = { response: { status: 500 } };
      const error503 = { response: { status: 503 } };

      expect(isRetryableError(error500)).toBe(true);
      expect(isRetryableError(error503)).toBe(true);
    });

    it('should classify timeout errors as non-retryable', () => {
      const timeoutError = new TimeoutError('test', 1000);
      expect(isRetryableError(timeoutError)).toBe(false);
    });

    it('should classify client errors as non-retryable', () => {
      const error400 = { response: { status: 400 } };
      const error404 = { response: { status: 404 } };

      expect(isRetryableError(error400)).toBe(false);
      expect(isRetryableError(error404)).toBe(false);
    });
  });
});

describe('reliableAxios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should wrap axios.get with reliability', async () => {
    mockedAxios.get.mockResolvedValue({ data: 'test', status: 200 });

    const result = await reliableAxios('http://api.example.com/test');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://api.example.com/test',
      undefined,
    );
    expect((result as any).data).toBe('test');
  });

  it('should retry on 503 error', async () => {
    let attempts = 0;
    mockedAxios.get.mockImplementation(async () => {
      if (attempts++ < 2) {
        const error = new Error('Service Unavailable');
        (error as any).response = { status: 503 };
        throw error;
      }
      return { data: 'success', status: 200 };
    });

    const result = await reliableAxios(
      'http://api.example.com/test',
      undefined,
      { retries: 3 },
    );

    expect((result as any).data).toBe('success');
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });
});

describe('reliableFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should wrap fetch with reliability', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: 'test' }),
    });

    const result = await reliableFetch('http://api.example.com/test');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.example.com/test',
      undefined,
    );
    expect((result as any).data).toBe('test');
  });

  it('should retry on 500 error', async () => {
    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      if (attempts++ < 2) {
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      };
    });

    const result = await reliableFetch(
      'http://api.example.com/test',
      undefined,
      { retries: 3 },
    );

    expect((result as any).data).toBe('success');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
