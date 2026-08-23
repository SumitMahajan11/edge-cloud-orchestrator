import { PrismaClient } from '@prisma/client';
import { requireProdConfirm } from './require-prod-confirm';
import * as fs from 'fs';

requireProdConfirm();
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlLine = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='));
const dbUrl = dbUrlLine ? dbUrlLine.split('=')[1].trim() : '';

console.log('Parsed DATABASE_URL from .env file:', dbUrl.replace(/:[^:@]+@/, ':***@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function main() {
  console.log('Connecting to host:', new URL(dbUrl).host);
  
  // Find a user
  let user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found, creating a dummy user...');
    user = await prisma.user.create({
      data: {
        email: 'bootstrap-creator@edge-cloud.io',
        passwordHash: 'dummy',
        name: 'Bootstrap Creator',
      }
    });
  }
  
  const tokenString = `boot-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
  
  const token = await prisma.bootstrapToken.create({
    data: {
      token: tokenString,
      createdBy: user.id,
      expiresAt: expiresAt
    }
  });
  
  console.log('Successfully created BootstrapToken!');
  console.log('Token:', token.token);
  console.log('Created By:', token.createdBy);
  console.log('Expires At:', token.expiresAt);
}

main().catch(console.error).finally(() => prisma.$disconnect());
