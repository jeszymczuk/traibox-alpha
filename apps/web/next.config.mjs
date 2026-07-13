/** @type {import('next').NextConfig} */
const production = process.env.NODE_ENV === 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${production ? '' : ' ws://localhost:3000 http://localhost:3000'}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'"
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : [])
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@traibox/contracts'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // ESLint 9 is enforced once at the monorepo root. Next's build-time runner does
  // not load the root suppression inventory, so running it again would report
  // baselined legacy debt instead of the repository's enforced lint result.
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
