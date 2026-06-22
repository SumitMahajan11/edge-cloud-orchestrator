import Redis from "ioredis";
import { createLogger } from "@edgecloud/shared-kernel";

const logger = createLogger("grid-carbon-client");

const FALLBACK_CARBON_TABLE: Record<string, number> = {
  "EU-DE": 350,
  "US-WEST": 180,
  "US-EAST": 420,
  "AP-SG": 500,
  "US-CENTER": 300,
  "EU-FR": 60,
  "EU-UK": 200,
};

export class GridCarbonClient {
  private readonly baseUrl = "https://api.electricitymap.org/v3";
  private readonly cachePrefix = "carbon:zone:";

  constructor(
    private redis: Redis,
    private apiKey?: string,
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
        this.apiKey === "placeholder" ||
        this.apiKey === "your-api-key-here" ||
        process.env.NODE_ENV === "test"
      ) {
        throw new Error("Electricity Maps API key not configured");
      }

      const response = await fetch(
        `${this.baseUrl}/carbon-intensity/latest?zone=${zone}`,
        {
          headers: { "auth-token": this.apiKey },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Electricity Maps API responded with status: ${response.status}`,
        );
      }

      const data = (await response.json()) as any;
      const intensity = data.carbonIntensity;

      if (typeof intensity !== "number") {
        throw new Error("Invalid response format from Electricity Maps API");
      }

      // 3. Store in cache (5-minute TTL)
      await this.redis.set(cacheKey, intensity.toString(), "EX", 300);

      logger.debug({ zone, intensity }, "Fetched carbon intensity from API");
      return intensity;
    } catch (error: any) {
      const fallback = FALLBACK_CARBON_TABLE[zone] || 400;
      logger.warn(
        { zone, error: error.message, fallback },
        "Failed to fetch carbon intensity, using fallback",
      );
      return fallback;
    }
  }

  /**
   * Get 24-hour carbon intensity forecast for a specific zone
   */
  async getCarbonIntensityForecast(
    zone: string,
  ): Promise<{ datetime: string; carbonIntensity: number }[]> {
    const cacheKey = `${this.cachePrefix}${zone}:forecast`;

    try {
      // 1. Try Redis cache
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // 2. Fetch from Electricity Maps API
      if (
        !this.apiKey ||
        this.apiKey === "placeholder" ||
        this.apiKey === "your-api-key-here" ||
        process.env.NODE_ENV === "test"
      ) {
        throw new Error("Electricity Maps API key not configured");
      }

      const response = await fetch(
        `${this.baseUrl}/carbon-intensity/forecast?zone=${zone}`,
        {
          headers: { "auth-token": this.apiKey },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Electricity Maps API responded with status: ${response.status}`,
        );
      }

      const data = (await response.json()) as any;
      const forecast = data.forecast;

      if (!Array.isArray(forecast)) {
        throw new Error("Invalid response format from Electricity Maps API forecast");
      }

      const result = forecast.map((f: any) => ({
        datetime: f.datetime,
        carbonIntensity: f.carbonIntensity,
      }));

      // 3. Store in cache (15-minute TTL for forecast)
      await this.redis.set(cacheKey, JSON.stringify(result), "EX", 900);

      logger.debug({ zone, forecastLength: result.length }, "Fetched carbon forecast from API");
      return result;
    } catch (error: any) {
      // Fallback: Generate mock 24h forecast based on base intensity
      const baseIntensity = FALLBACK_CARBON_TABLE[zone] || 400;
      const result = [];
      const now = new Date();
      for (let i = 0; i < 24; i++) {
        const datetime = new Date(now.getTime() + i * 60 * 60 * 1000);
        // Introduce a diurnal cycle with sine wave (lowest at mid-day when solar is high)
        const hour = datetime.getUTCHours();
        const variation = Math.sin(((hour - 12) / 24) * 2 * Math.PI) * 0.25; // +/- 25% variation
        const intensity = Math.round(baseIntensity * (1 + variation));
        result.push({
          datetime: datetime.toISOString(),
          carbonIntensity: intensity,
        });
      }
      logger.warn(
        { zone, error: error.message, fallbackLength: result.length },
        "Failed to fetch carbon forecast, using generated fallback",
      );
      return result;
    }
  }

  /**
   * Map region to zone
   */
  mapRegionToZone(region: string): string {
    const upper = region.toUpperCase();
    if (upper.startsWith("US-WEST")) return "US-WEST";
    if (upper.startsWith("US-EAST")) return "US-EAST";
    if (upper.startsWith("EU-DE")) return "EU-DE";
    if (upper.startsWith("AP-SG")) return "AP-SG";
    return upper;
  }
}
