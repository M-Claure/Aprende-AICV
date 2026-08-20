/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only heavy deps out of the bundle. `@sparticuz/chromium` matters
  // most: it ships a Brotli-compressed Chromium under bin/, which the bundler must
  // copy as a file rather than try to trace and inline.
  experimental: {
    serverComponentsExternalPackages: [
      "puppeteer",
      "puppeteer-core",
      "@sparticuz/chromium",
      "openai",
    ],
  },
};

export default nextConfig;
