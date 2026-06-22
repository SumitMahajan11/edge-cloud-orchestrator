import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  forcePathStyle: true,
});

async function ensureBucket(bucketName: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`Bucket '${bucketName}' already exists.`);
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      console.log(`Bucket '${bucketName}' not found. Creating...`);
      await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`Bucket '${bucketName}' created successfully.`);
    } else {
      console.error(`Error checking/creating bucket '${bucketName}':`, err);
      throw err;
    }
  }
}

async function main() {
  await ensureBucket("edge-cloud-models");
  await ensureBucket("edgecloud-reports");
}

main().catch(console.error);
