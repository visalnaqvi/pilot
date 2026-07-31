import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Admin is a Node.js server SDK. Keep it external so Node resolves
  // the package's CommonJS entry points instead of bundling its ESM wrappers.
  serverExternalPackages: ['firebase-admin'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/mock-test-app-b659d.firebasestorage.app/o/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
