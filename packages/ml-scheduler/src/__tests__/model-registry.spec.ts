import { ModelRegistry, ModelMetadata } from '../registry';
import { Redis } from 'ioredis';
import fs from 'fs';
import path from 'path';

vi.mock('ioredis');
vi.mock('fs');

describe('ModelRegistry', () => {
  let registry: ModelRegistry;
  let redis: vi.Mocked<Redis>;
  const mockModelDir = '/tmp/models';

  beforeEach(() => {
    vi.clearAllMocks();
    redis = new Redis() as any;
    
    // Default fs mocks
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue([]);
    (fs.readFileSync as any).mockReturnValue('{}');
    
    registry = new ModelRegistry(redis, mockModelDir);
  });

  describe('Hot-swap', () => {
    it('should identify when a model update is needed', async () => {
      redis.get.mockResolvedValue('v1.1.0');
      const meta: ModelMetadata = { version: 'v1.1.0' } as any;
      
      // Mock getModelMetadata behavior
      (fs.existsSync as any).mockImplementation((p: string) => p.includes('v1.1.0'));
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(meta));

      const active = await registry.getActiveModel();
      expect(active?.version).toBe('v1.1.0');
    });
  });

  describe('Rollback', () => {
    it('should successfully rollback to previous version', async () => {
      redis.lpop.mockResolvedValue('v1.0.0');
      
      const previous = await registry.rollbackModel();
      
      expect(previous).toBe('v1.0.0');
      expect(redis.set).toHaveBeenCalledWith('ml:active_model_version', 'v1.0.0');
      expect(redis.publish).toHaveBeenCalledWith('ml:model_updated', 'v1.0.0');
    });
  });

  describe('Promotion', () => {
    it('should promote a model and store the current in history', async () => {
      redis.get.mockResolvedValue('v1.0.0');
      (fs.existsSync as any).mockReturnValue(true);

      await registry.promoteModel('v1.1.0');

      expect(redis.lpush).toHaveBeenCalledWith('ml:model_version_history', 'v1.0.0');
      expect(redis.set).toHaveBeenCalledWith('ml:active_model_version', 'v1.1.0');
    });
  });

  describe('Version check', () => {
    it('should respect MIN_MODEL_VERSION during load (tested via predictor integration)', async () => {
      const { SchedulingPredictor } = await import('../predictor');
      const predictor = new SchedulingPredictor();
      
      process.env.MIN_MODEL_VERSION = '2.0.0';
      try {
        const lowVersionMeta = { version: '1.9.9', algorithm: 'XGBoost' };
        (fs.readFileSync as any).mockReturnValue(JSON.stringify(lowVersionMeta));
        
        await predictor.loadModel(mockModelDir, '1.9.9');
        throw new Error('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('below minimum required version');
      } finally {
        delete process.env.MIN_MODEL_VERSION;
      }
    });
  });

  describe('Concurrency', () => {
    it('should handle concurrent requests during hot-swap without error', async () => {
      const { MLScheduler } = await import('../ml-scheduler');
      const { SchedulingPredictor } = await import('../predictor');
      const predictor = new SchedulingPredictor();
      const metrics = {
        recordMLFallback: vi.fn(),
        recordSchedulingDecision: vi.fn(),
        recordMetric: vi.fn(),
        recordCarbonMetrics: vi.fn(),
      };
      const outcomeCollector = {
        getReward: vi.fn().mockResolvedValue(0.5),
        onOutcomeRecorded: vi.fn(),
      } as any;
      const detector = { isDrifting: () => false } as any;
      const scheduler = new MLScheduler(predictor, registry, detector, metrics as any, outcomeCollector);

      // Simulate a hot-swap starting
      redis.get.mockResolvedValue('v2.0.0');
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({ version: 'v2.0.0', algorithm: 'XGBoost' }));

      // Fire off multiple schedule requests and one hot-swap check
      const results = await Promise.all([
        scheduler.schedule({ id: 't1' } as any, [], {} as any),
        scheduler.checkHotSwap(),
        scheduler.schedule({ id: 't2' } as any, [], {} as any)
      ]);

      expect(results).toBeDefined();
      expect(predictor.getVersion()).toBe('v2.0.0');
    });
  });
});
