import { parseArgs } from 'util';

export function requireProdConfirm() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes('ep-round-dust-aowooyht-pooler.c-2.ap-southeast-1.aws.neon.tech')) {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        'confirm-prod': {
          type: 'boolean',
        },
      },
      strict: false,
    });

    if (!values['confirm-prod']) {
      console.error(
        '\\n\\x1b[31m[ERROR] PRODUCTION DATABASE DETECTED\\x1b[0m'
      );
      console.error(
        'You are running a mutating script against the live production Neon database.\\n' +
        'To proceed, you must append the flag: --confirm-prod\\n' +
        'Example: npx tsx scripts/your_script.ts --confirm-prod\\n'
      );
      process.exit(1);
    }
  }
}
