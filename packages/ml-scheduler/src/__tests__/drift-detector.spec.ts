import { IMetricsCollector } from '@edgecloud/shared-kernel';

import { DriftDetector } from '../drift-detector';

describe('DriftDetector PSI Analysis', () => {
  let detector: DriftDetector;
  let metrics: vi.Mocked<IMetricsCollector>;
  let prisma: any;

  beforeEach(() => {
    metrics = {
      updateMLDrift: vi.fn(),
    } as any;

    prisma = {
      outcomeLog: {
        findMany: vi.fn(),
      },
    };

    detector = new DriftDetector(metrics, prisma);
  });

  it('Test 1 - No drift: same distribution - PSI < 0.1', async () => {
    const data = [];
    for (let i = 0; i < 200; i++) {
      data.push({
        actualCpuUsage: 0.4,
        actualMemoryUsage: 0.2,
        actualLatencyMs: 100,
        outcome: 'SUCCESS',
        createdAt: new Date()
      });
    }

    prisma.outcomeLog.findMany
      .mockResolvedValueOnce(data.slice(0, 100)) // baseline
      .mockResolvedValueOnce(data.slice(100, 200)); // current

    const state = await detector.getState();
    expect(state.driftScore).toBeLessThan(0.1);
    expect(state.recommendation).toBe('STABLE');
  });

  it('Test 2 - Clear drift: CPU values shift from mean=0.4 to mean=0.9 - PSI > 0.25', async () => {
    const baseline = [];
    for (let i = 0; i < 100; i++) {
      baseline.push({
        actualCpuUsage: 0.4,
        actualMemoryUsage: 0.2,
        actualLatencyMs: 100,
        outcome: 'SUCCESS',
        createdAt: new Date()
      });
    }

    const current = [];
    for (let i = 0; i < 50; i++) {
      current.push({
        actualCpuUsage: 0.9,
        actualMemoryUsage: 0.2,
        actualLatencyMs: 100,
        outcome: 'SUCCESS',
        createdAt: new Date()
      });
    }

    prisma.outcomeLog.findMany
      .mockResolvedValueOnce(baseline)
      .mockResolvedValueOnce(current);

    const state = await detector.getState();
    expect(state.driftScore).toBeGreaterThan(0.25);
    expect(state.isDrifting).toBe(true);
    expect(state.recommendation).toBe('RETRAIN');
  });

  it('Test 3 - Insufficient data: < 100 baseline samples - returns INSUFFICIENT_DATA', async () => {
    prisma.outcomeLog.findMany
      .mockResolvedValueOnce(new Array(50).fill({})) // baseline < 100
      .mockResolvedValueOnce(new Array(50).fill({})); // current

    const state = await detector.getState();
    expect(state.recommendation).toBe('INSUFFICIENT_DATA');
    expect(state.isDrifting).toBe(false);
  });

  it('Test 4 - Feature drift correctly identifies WHICH feature drifted most', async () => {
    const baseline = [];
    for (let i = 0; i < 100; i++) {
      baseline.push({
        actualCpuUsage: 0.4,
        actualMemoryUsage: 0.5,
        actualLatencyMs: 100,
        outcome: 'SUCCESS',
      });
    }

    const current = [];
    for (let i = 0; i < 50; i++) {
      current.push({
        actualCpuUsage: 0.4, // CPU stable
        actualMemoryUsage: 0.9, // Memory drifted
        actualLatencyMs: 100, // Latency stable
        outcome: 'SUCCESS',
      });
    }

    prisma.outcomeLog.findMany
      .mockResolvedValueOnce(baseline)
      .mockResolvedValueOnce(current);

    const state = await detector.getState();
    expect(state.featureDrift.memoryUsage).toBeGreaterThan(state.featureDrift.cpuUsage);
    expect(state.featureDrift.memoryUsage).toBeGreaterThan(state.featureDrift.latency);
    expect(state.driftScore).toBe(state.featureDrift.memoryUsage);
  });
});
