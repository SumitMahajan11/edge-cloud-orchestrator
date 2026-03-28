import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerRegistry, CircuitBreakerOpenError } from '../src/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenMaxCalls: 2,
      successThreshold: 2,
    });
  });

  afterEach(() => {
    breaker.removeAllListeners();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().failures).toBe(0);
      expect(breaker.getMetrics().totalCalls).toBe(0);
    });
  });

  describe('CLOSED state', () => {
    it('should execute successful operations', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should count failures but stay closed under threshold', async () => {
      const failingFn = async () => { throw new Error('test error'); };
      
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (e) {}
      }
      
      expect(breaker.getMetrics().failures).toBe(2);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open after reaching failure threshold', async () => {
      const failingFn = async () => { throw new Error('test error'); };
      
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (e) {}
      }
      
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should reset failure count on success', async () => {
      const failingFn = async () => { throw new Error('test error'); };
      
      try { await breaker.execute(failingFn); } catch (e) {}
      try { await breaker.execute(failingFn); } catch (e) {}
      
      expect(breaker.getMetrics().failures).toBe(2);
      
      await breaker.execute(async () => 'success');
      
      expect(breaker.getMetrics().failures).toBe(0);
      expect(breaker.getMetrics().successes).toBe(1);
    });
  });

  describe('OPEN state', () => {
    beforeEach(async () => {
      const failingFn = async () => { throw new Error('test error'); };
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failingFn); } catch (e) {}
      }
    });

    it('should reject calls immediately', async () => {
      await expect(breaker.execute(async () => 'success'))
        .rejects.toThrow(CircuitBreakerOpenError);
      
      expect(breaker.getMetrics().rejectedCalls).toBe(1);
    });

    it('should use fallback when provided', async () => {
      const result = await breaker.execute(
        async () => 'primary',
        () => 'fallback'
      );
      
      expect(result).toBe('fallback');
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      vi.useFakeTimers();
      
      // Wait for reset timeout
      await vi.advanceTimersByTimeAsync(1100);
      
      // Next call should transition to half-open
      try {
        await breaker.execute(async () => 'test');
      } catch (e) {}
      
      expect(breaker.getState()).toBe('HALF_OPEN');
      
      vi.useRealTimers();
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      
      const failingFn = async () => { throw new Error('test error'); };
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failingFn); } catch (e) {}
      }
      
      // Wait for reset timeout
      await vi.advanceTimersByTimeAsync(1100);
      
      vi.useRealTimers();
    });

    it('should close after enough successes', async () => {
      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');
      
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open again on any failure', async () => {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('events', () => {
    it('should emit state change events', async () => {
      const stateChanges: string[] = [];
      breaker.on('stateChange', (state) => stateChanges.push(state));
      
      const failingFn = async () => { throw new Error('test error'); };
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failingFn); } catch (e) {}
      }
      
      expect(stateChanges).toContain('OPEN');
    });

    it('should emit success events', async () => {
      const successes: any[] = [];
      breaker.on('success', (result) => successes.push(result));
      
      await breaker.execute(async () => 'test-result');
      
      expect(successes).toContain('test-result');
    });

    it('should emit failure events', async () => {
      const failures: Error[] = [];
      breaker.on('failure', (error) => failures.push(error));
      
      try {
        await breaker.execute(async () => { throw new Error('test'); });
      } catch (e) {}
      
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe('test');
    });
  });

  describe('metrics', () => {
    it('should track all metrics correctly', async () => {
      // 5 successful calls
      for (let i = 0; i < 5; i++) {
        await breaker.execute(async () => i);
      }
      
      // 2 failed calls
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      const metrics = breaker.getMetrics();
      
      expect(metrics.totalCalls).toBe(7);
      expect(metrics.successes).toBe(5);
      expect(metrics.failures).toBe(2);
      expect(metrics.state).toBe('CLOSED');
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  it('should create and cache breakers by name', () => {
    const breaker1 = registry.getOrCreate('service-a');
    const breaker2 = registry.getOrCreate('service-a');
    
    expect(breaker1).toBe(breaker2);
  });

  it('should create different breakers for different names', () => {
    const breaker1 = registry.getOrCreate('service-a');
    const breaker2 = registry.getOrCreate('service-b');
    
    expect(breaker1).not.toBe(breaker2);
  });

  it('should return all breakers', () => {
    registry.getOrCreate('service-a');
    registry.getOrCreate('service-b');
    
    const all = registry.getAll();
    
    expect(all.size).toBe(2);
    expect(all.has('service-a')).toBe(true);
    expect(all.has('service-b')).toBe(true);
  });

  it('should return all metrics', () => {
    registry.getOrCreate('service-a');
    registry.getOrCreate('service-b');
    
    const metrics = registry.getAllMetrics();
    
    expect(Object.keys(metrics)).toContain('service-a');
    expect(Object.keys(metrics)).toContain('service-b');
  });
});
