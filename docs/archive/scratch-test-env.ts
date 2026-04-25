import { validateEnv } from './packages/shared-kernel/src/config/validate-env';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load the consolidated env file
dotenv.config({ path: path.resolve(__dirname, 'config/.env.local') });

try {
  const env = validateEnv();
  console.log('Validation successful!');
  console.log('NODE_ENV:', env.NODE_ENV);
  console.log('DATABASE_URL:', env.DATABASE_URL.replace(/:[^:@]*@/, ':****@')); // Hide password
} catch (err) {
  console.error('Validation failed!');
  process.exit(1);
}
