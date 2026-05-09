import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

const root = join(__dirname, '..');
const apiPackageJson = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'));
const sdkPackageJson = JSON.parse(readFileSync(join(root, 'packages/api-client/package.json'), 'utf8'));
const openapi = parse(readFileSync(join(root, 'apps/api/openapi-v2.yml'), 'utf8'));

const apiVersion = apiPackageJson.version;
const sdkVersion = sdkPackageJson.version;
const openapiVersion = openapi.info.version;

console.log(`API version: ${apiVersion}`);
console.log(`SDK version: ${sdkVersion}`);
console.log(`OpenAPI version: ${openapiVersion}`);

if (apiVersion !== sdkVersion) {
  console.error('❌ SDK version does not match API version!');
  process.exit(1);
}

if (apiVersion !== openapiVersion) {
  console.error('❌ OpenAPI version does not match API version!');
  process.exit(1);
}

console.log('✅ Versions match!');
process.exit(0);
