import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi-v2.yml',
  output: '../../packages/api-client/src',
  client: 'fetch',
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@hey-api/transformers',
      dates: true,
    },
    'zod',
  ],
});
