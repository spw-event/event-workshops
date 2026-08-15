import type { NextConfig } from "next";

const baseConfig: NextConfig = {};

// next-pwa uses a webpack plugin; only apply it in production where we
// explicitly run `next build --webpack` to opt out of Turbopack (Next.js 16 default).
// In dev, Turbopack runs as normal with no service worker overhead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = process.env.NODE_ENV === 'production'
  ? require('next-pwa')({ dest: 'public', register: true, skipWaiting: true })(baseConfig)
  : baseConfig

export default config;
