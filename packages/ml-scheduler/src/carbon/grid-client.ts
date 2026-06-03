import Redis from 'ioredis';
import { createLogger } from '@edgecloud/shared-kernel';

const logger = createLogger('grid-carbon-client');

const FALLBACK_CARBON_TABLE: Record<string, number> = {
  'EU-DE': 350,
  'US-WEST': 180,
  'US-EAST': 420,
  'AP-SG': 500,
  'US-CENTER': 300,
  'EU-FR': 60,
  'EU-UK': 200,
};

export class GridCarbonClient {
  private readonly baseUrl = 'https://api.electricitymap.org/v3';
  private readonly cachePrefix = 'carbon:zone:';

  constructor(
    private redis: Redis,
    private apiKey?: string
  ) {}

  /**
   * Get carbon intensity for a specific zone (gCO2eq/kWh)
   */
  async getCarbonIntensity(zone: string): Promise<number> {
    const cacheKey = `${this.cachePrefix}${zone}`;
    
    try {
      // 1. Try Redis cache
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return parseFloat(cached);
      }

      // 2. Fetch from Electricity Maps API
      if (
        !this.apiKey ||
        this.apiKey === 'placeholder' ||
        this.apiKey === 'your-api-key-here' ||
        process.env.NODE_ENV === 'test'
      ) {
        throw new Error('Electricity Maps API key not configured');
      }

      const response = await fetch(`${this.baseUrl}/carbon-intensity/latest?zone=${zone}`, {
        headers: { 'auth-token': this.apiKey }
      });

      if (!response.ok) {
        throw new Error(`Electricity Maps API responded with status: ${response.status}`);
      }

      const data = await response.json() as any;
      const intensity = data.carbonIntensity;

      if (typeof intensity !== 'number') {
        throw new Error('Invalid response format from Electricity Maps API');
      }

      // 3. Store in cache (5-minute TTL)
      await this.redis.set(cacheKey, intensity.toString(), 'EX', 300);
      
      logger.debug({ zone, intensity }, 'Fetched carbon intensity from API');
      return intensity;
    } catch (error: any) {
      const fallback = FALLBACK_CARBON_TABLE[zone] || 400;
      logger.warn({ zone, error: error.message, fallback }, 'Failed to fetch carbon intensity, using fallback');
      return fallback;
    }
  }

  /**
   * Map region to grid zone (e.g., 'us-west-1' -> 'US-WEST')
   */
  mapRegionToZone(region: string): string {
    const upper = region.toUpperCase();
    if (upper.startsWith('US-WEST')) return 'US-WEST';
    if (upper.startsWith('US-EAST')) return 'US-EAST';
    if (upper.startsWith('EU-DE')) return 'EU-DE';
    if (upper.startsWith('AP-SG')) return 'AP-SG';
    return upper;
  }
}
