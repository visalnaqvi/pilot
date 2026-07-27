import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Firebase Admin inside the server bundle across Vercel runtimes.
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
