/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@traibox/contracts'],
  // ESLint 9 is enforced once at the monorepo root. Next's build-time runner does
  // not load the root suppression inventory, so running it again would report
  // baselined legacy debt instead of the repository's enforced lint result.
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
