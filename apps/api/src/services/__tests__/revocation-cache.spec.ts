import 'reflect-metadata';
import { CertificateValidator } from '../mtls-authentication';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';

describe('CertificateValidator Revocation Cache', () => {
  let prisma: any;
  const logger = pino({ level: 'silent' });
  let validator: CertificateValidator;

  beforeEach(() => {
    prisma = {
      certificateRevocation: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };
    validator = new CertificateValidator(prisma as unknown as PrismaClient, logger);
  });

  it('should hit database on first check of a non-revoked certificate', async () => {
    const serial = 'TEST-SERIAL-1';
    prisma.certificateRevocation.findUnique.mockResolvedValue(null);

    const result = await (validator as any).isRevoked(serial);
    
    expect(result).toBe(false);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledWith({
      where: { serialNumber: serial },
    });
  });

  it('should NOT hit database on second check of a non-revoked certificate within TTL', async () => {
    const serial = 'TEST-SERIAL-2';
    prisma.certificateRevocation.findUnique.mockResolvedValue(null);

    // First call - hits DB
    await (validator as any).isRevoked(serial);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1);

    // Second call - should hit cache
    const result = await (validator as any).isRevoked(serial);
    
    expect(result).toBe(false);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1); // Still 1
  });

  it('should hit database again after TTL expires for non-revoked certificate', async () => {
    const serial = 'TEST-SERIAL-3';
    prisma.certificateRevocation.findUnique.mockResolvedValue(null);

    // Mock Date.now to control time
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    // First call
    await (validator as any).isRevoked(serial);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1);

    // Move time forward past TTL (5 mins = 300,000ms)
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_001);

    // Second call - should hit DB again
    const result = await (validator as any).isRevoked(serial);
    
    expect(result).toBe(false);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(2);
    
    vi.restoreAllMocks();
  });

  it('should return true immediately for revoked certificates without hitting DB twice', async () => {
    const serial = 'REVOKED-SERIAL';
    prisma.certificateRevocation.findUnique.mockResolvedValue({ serialNumber: serial });

    // First call
    await (validator as any).isRevoked(serial);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1);

    // Second call
    const result = await (validator as any).isRevoked(serial);
    
    expect(result).toBe(true);
    expect(prisma.certificateRevocation.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should pre-populate cache in refreshCRLIfNeeded', async () => {
    const serial1 = 'REVOKED-1';
    const serial2 = 'REVOKED-2';
    prisma.certificateRevocation.findMany.mockResolvedValue([
      { serialNumber: serial1 },
      { serialNumber: serial2 },
    ]);

    // Force refresh
    await (validator as any).refreshCRLIfNeeded();

    expect(prisma.certificateRevocation.findMany).toHaveBeenCalledTimes(1);

    // Checks should now hit cache
    const result1 = await (validator as any).isRevoked(serial1);
    const result2 = await (validator as any).isRevoked(serial2);

    expect(result1).toBe(true);
    expect(result2).toBe(true);
    expect(prisma.certificateRevocation.findUnique).not.toHaveBeenCalled();
  });
});
