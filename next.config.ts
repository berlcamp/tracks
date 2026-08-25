import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: true,
  // This app is fully dynamic. No cacheComponents, no PPR, no ISR: every route
  // is authenticated and role-scoped, and a cached fragment leaking one
  // department's figures into another's request is the exact thing RLS exists
  // to prevent.
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '127.0.0.1', port: '54821' },
      { protocol: 'http', hostname: 'localhost', port: '54821' },
    ],
  },
}

export default nextConfig
