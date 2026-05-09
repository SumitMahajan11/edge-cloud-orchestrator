import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import crypto from 'crypto';

/**
 * Configuration for ModelStorageService
 */
export interface ModelStorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
}

/**
 * Service for handling ML model weights storage in S3/GCS.
 * Offloads binary blobs from PostgreSQL to object storage.
 */
export class ModelStorageService {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.MODEL_STORAGE_BUCKET || 'edge-cloud-models';
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
  }

  /**
   * Uploads model weights to object storage and returns the SHA-256 checksum.
   * 
   * @param modelId Unique identifier for the model
   * @param buffer Binary weight data
   * @returns The S3 key/URL and the SHA-256 checksum
   */
  async uploadWeights(modelId: string, buffer: Buffer): Promise<{ url: string; checksum: string }> {
    const key = `models/${modelId}/weights.bin`;
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'x-amz-meta-checksum-sha256': checksum
        }
      },
    });

    await upload.done();
    return { url: key, checksum };
  }

  /**
   * Downloads model weights from object storage and verifies integrity.
   * 
   * @param weightsUrl The S3 key or URL
   * @param expectedChecksum Optional SHA-256 checksum to verify integrity
   * @returns Binary weight data as a Buffer
   */
  async downloadWeights(weightsUrl: string, expectedChecksum?: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: weightsUrl,
    });

    const response = await this.client.send(command);
    const stream = response.Body as Readable;

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });

    if (expectedChecksum) {
      const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualChecksum !== expectedChecksum) {
        throw new Error(`Integrity Failure: Model weights checksum mismatch. Expected ${expectedChecksum}, got ${actualChecksum}`);
      }
    }

    return buffer;
  }
}
