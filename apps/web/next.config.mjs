/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@edgecloud/api-client'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [
        { module: /node_modules\/require-in-the-middle/ },
        { module: /node_modules\/@opentelemetry\/instrumentation/ },
      ];
    }
    return config;
  },
};

export default nextConfig;
