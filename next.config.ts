import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The service worker must always be revalidated so updates roll out.
        source: '/sw.js',
        headers: [{ key: 'cache-control', value: 'no-cache' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'x-frame-options', value: 'DENY' },
          { key: 'referrer-policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
