/**
 * Safely configure the test environment to simulate production mode
 * without triggering destructive startup checks.
 *
 * Usage:
 *   beforeAll(() => configureForProductionTest());
 *   afterAll(() => restoreTestEnvironment(savedEnv));
 */
export function configureForProductionTest(): Record<string, string | undefined> {
  const saved = { ...process.env };

  // Simulate production environment
  process.env.NODE_ENV = 'production';

  // Prevent real database/Redis connections
  process.env.FORCE_MOCK_DB = 'true';
  process.env.FORCE_MOCK_REDIS = 'true';

  // Use a safe JWT secret — must not contain: demo, test, secret, password, 123456
  // Using 'a'.repeat(32) guarantees no substring matches
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.ENCRYPTION_KEY = 'b'.repeat(32);

  // Database URL with required SSL flag for production validation
  process.env.DATABASE_URL = 'postgresql://localhost:5432/db?sslmode=require';

  return saved;
}

export function restoreTestEnvironment(saved: Record<string, string | undefined>): void {
  // Restore all original values
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
