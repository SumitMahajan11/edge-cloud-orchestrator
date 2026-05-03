import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function validateMigrations() {
  const migrationsDir = path.join(__dirname, '../apps/api/prisma/migrations');
  const migrationFolders = fs.readdirSync(migrationsDir).filter(f => fs.lstatSync(path.join(migrationsDir, f)).isDirectory());

  // We only want to check "pending" migrations if we were running in a real deployment
  // For this task, we will check all migrations to demonstrate the validation logic
  
  for (const folder of migrationFolders) {
    const sqlPath = path.join(migrationsDir, folder, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const issues: string[] = [];

    // 1. Check for risky operations
    if (sql.match(/DROP\s+TABLE/i)) issues.push('DROP TABLE detected');
    if (sql.match(/DROP\s+COLUMN/i)) issues.push('DROP COLUMN detected');
    if (sql.match(/RENAME\s+TO/i)) issues.push('RENAME detected');
    if (sql.match(/ALTER\s+COLUMN.*SET\s+NOT\s+NULL/i)) issues.push('ALTER COLUMN SET NOT NULL detected');

    // 2. Check for non-concurrent indexes
    const createIndexMatches = sql.matchAll(/CREATE\s+INDEX\s+(?!CONCURRENTLY)(\w+)\s+ON\s+"?(\w+)"?/gi);
    for (const match of createIndexMatches) {
      const indexName = match[1];
      const tableName = match[2];
      
      try {
        const rowCount = await getTableRowCount(tableName);
        if (rowCount > 100000) {
          issues.push(`Non-concurrent index "${indexName}" on large table "${tableName}" (${rowCount} rows)`);
        }
      } catch (e) {
        // Table might not exist yet if it's the init migration
      }
    }

    if (issues.length > 0) {
      console.warn(`\n⚠️  RISKY MIGRATION DETECTED: ${folder}`);
      issues.forEach(issue => console.warn(`   - ${issue}`));
      
      if (process.env.CONFIRM_RISKY_MIGRATION !== 'true') {
        console.error('\n❌ Validation failed. Set CONFIRM_RISKY_MIGRATION=true to proceed.');
        process.exit(1);
      } else {
        console.warn('\n✅ Proceeding with risky migration (confirmed by environment variable).');
      }
    }
  }

  console.log('\n✅ All migrations validated.');
  await prisma.$disconnect();
}

async function getTableRowCount(tableName: string): Promise<number> {
  try {
    const result: any[] = await prisma.$queryRawUnsafe(`SELECT count(*) FROM "${tableName}"`);
    return parseInt(result[0].count, 10);
  } catch (e) {
    return 0;
  }
}

validateMigrations().catch(err => {
  console.error(err);
  process.exit(1);
});
