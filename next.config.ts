import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Admin 14 reaches ESM-only jose through CommonJS jwks-rsa.
  transpilePackages: ['firebase-admin'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/mock-test-app-b659d.firebasestorage.app/o/**',
      },
    ],
  },
};

export default nextConfig;
