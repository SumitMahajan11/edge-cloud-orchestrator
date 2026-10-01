import { describe, it, expect } from 'vitest';
import { registerSchema, createNodeSchema } from '../schemas/index';

describe('Schema Regex Validation Tests', () => {
  describe('registerSchema name regex', () => {
    it('accepts valid names containing letters, spaces, hyphens, and dots', () => {
      const validNames = [
        'John Doe',
        'Mary-Jane',
        'Dr. Smith',
        'St. John-Smythe',
        'Alice Bob Carol',
      ];
      for (const name of validNames) {
        const result = registerSchema.safeParse({
          email: 'user@example.com',
          password: 'Password123!',
          name,
        });
        expect(result.success, `Expected "${name}" to be valid`).toBe(true);
      }
    });

    it('rejects names with invalid special characters or numbers', () => {
      const invalidNames = ['User@123', 'John <script>', 'Doe#1', 'Name$'];
      for (const name of invalidNames) {
        const result = registerSchema.safeParse({
          email: 'user@example.com',
          password: 'Password123!',
          name,
        });
        expect(result.success, `Expected "${name}" to be invalid`).toBe(false);
      }
    });
  });

  describe('createNodeSchema location & region regexes', () => {
    const baseNode = {
      name: 'edge-node-1',
      ipAddress: '192.168.1.10',
      port: 8080,
      cpuCores: 8,
      memoryGB: 16,
      storageGB: 500,
    };

    it('accepts valid location strings with alphanumeric, spaces, hyphens, underscores, commas, and dots', () => {
      const validLocations = [
        'us-east-1',
        'Data Center 1, Bldg. B',
        'US_East_1',
        'Floor 3, Rack-12.A',
      ];
      for (const location of validLocations) {
        const result = createNodeSchema.safeParse({
          ...baseNode,
          location,
          region: 'us-west-1',
        });
        expect(result.success, `Expected location "${location}" to be valid: ${result.error?.message}`).toBe(true);
      }
    });

    it('accepts valid lowercase alphanumeric regions with hyphens', () => {
      const validRegions = ['us-east-1', 'eu-west-2', 'ap-south-1', 'region1'];
      for (const region of validRegions) {
        const result = createNodeSchema.safeParse({
          ...baseNode,
          location: 'US East',
          region,
        });
        expect(result.success, `Expected region "${region}" to be valid: ${result.error?.message}`).toBe(true);
      }
    });

    it('rejects invalid regions containing uppercase, spaces, or forbidden characters', () => {
      const invalidRegions = ['US-EAST-1', 'us_east_1', 'us east', 'eu.west'];
      for (const region of invalidRegions) {
        const result = createNodeSchema.safeParse({
          ...baseNode,
          location: 'US East',
          region,
        });
        expect(result.success, `Expected region "${region}" to be invalid`).toBe(false);
      }
    });
  });
});
