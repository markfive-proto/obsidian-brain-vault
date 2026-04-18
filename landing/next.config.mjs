import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Deployed at /brain-os (or similar). basePath can be set via env.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  trailingSlash: true,
  // Silence the "multiple lockfiles" warning — this project has its own.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
