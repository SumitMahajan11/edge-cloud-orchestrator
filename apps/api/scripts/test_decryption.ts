import { PrismaClient } from '@prisma/client';
import { decrypt, isEncrypted } from '../src/utils/encryption';

const prisma = new PrismaClient();

async function testDecryption() {
  try {
    const ca = await prisma.certificateAuthority.findFirst({
      where: { isActive: true },
      orderBy: { issuedAt: 'desc' },
    });

    if (!ca) {
      console.log('No active CA found');
      return;
    }

    console.log(`Found CA: ${ca.id}`);
    console.log(`Is Encrypted: ${isEncrypted(ca.privateKeyPem)}`);

    if (isEncrypted(ca.privateKeyPem)) {
      const decrypted = decrypt(ca.privateKeyPem);
      console.log('Successfully decrypted CA private key!');
      console.log('First 50 chars:', decrypted.substring(0, 50));
    } else {
      console.log('CA private key is not encrypted.');
    }
  } catch (err) {
    console.error('Decryption failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testDecryption();
