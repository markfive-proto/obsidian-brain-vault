import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: previously used `output: 'export'` for the static marketing site.
  // Removed so we can serve API routes that read from disk (the multi-vault
  // web app mode served by `obs serve`). Marketing-only deploys can still
  // set `NEXT_EXPORT=1` at build time if ever needed.
  ...(process.env.NEXT_EXPORT === '1' ? { output: 'export' } : {}),
  images: {
    unoptimized: true,
  },
  // Deployed at /brain-os (or similar). basePath can be set via env.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  // Silence the "multiple lockfiles" warning — this project has its own.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
