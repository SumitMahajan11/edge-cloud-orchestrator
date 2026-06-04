import * as sharedKernel from '@edgecloud/shared-kernel';
import pino from 'pino';
// using globals for vitest API

import { AlertingService } from '../alerting-service';

// Mock validateWebhookUrl
vi.mock('@edgecloud/shared-kernel', async () => {
  const actual = await vi.importActual('@edgecloud/shared-kernel');
  return {
    ...actual,
    validateWebhookUrl: vi.fn(),
  };
});

describe('AlertingService SSRF Protection', () => {
  let redis: any;
  let logger: any;
  let alertingService: AlertingService;
  const mockPayload = {
    id: 'alert-123',
    severity: 'CRITICAL' as const,
    title: 'Test Alert',
    description: 'Test Description',
    source: 'test',
    tenantId: 'tenant-1',
    firedAt: new Date().toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
  };

  beforeEach(() => {
    vi.mocked(sharedKernel.validateWebhookUrl).mockImplementation(async (url: string) => {
      if (url.includes('169.254.169.254') || url.includes('localhost') || url.includes('127.0.0.1')) {
        return { safe: false, reason: 'SSRF blocked' };
      }
      return { safe: true };
    });

    redis = {
      multi: vi.fn(() => redis),
      set: vi.fn().mockResolvedValue('OK'),
      lpush: vi.fn().mockResolvedValue(1),
      ltrim: vi.fn().mockResolvedValue('OK'),
      expire: vi.fn().mockResolvedValue(1),
      exec: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    };
    logger = pino({ level: 'silent' });
    vi.clearAllMocks();
  });

  it('blocks SSRF attempts targeting cloud metadata', async () => {
    const metadataUrl = 'http://169.254.169.254/latest/meta-data/';
    alertingService = new AlertingService(logger, redis, {
      webhookUrl: metadataUrl,
    });

    // Mock global fetch
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    // Use a spy on recordFailedDelivery
    const recordSpy = vi.spyOn(alertingService as any, 'recordFailedDelivery');

    await (alertingService as any).sendWebhook(mockPayload);

    // Webhook should NOT have been called
    expect(fetchMock).not.toHaveBeenCalled();

    // Failed delivery should be recorded in Redis
    expect(recordSpy).toHaveBeenCalledWith(
      metadataUrl,
      'SSRF_BLOCKED',
      'SSRF blocked'
    );
    expect(redis.lpush).toHaveBeenCalledWith('alerts:webhook:failures', expect.stringContaining('SSRF_BLOCKED'));
  });

  it('allows safe webhook URLs', async () => {
    const safeUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX';
    alertingService = new AlertingService(logger, redis, {
      webhookUrl: safeUrl,
    });

    // Mock global fetch
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    await (alertingService as any).sendWebhook(mockPayload);

    // Webhook SHOULD have been called
    expect(fetchMock).toHaveBeenCalledWith(safeUrl, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(mockPayload),
    }));
  });
});
