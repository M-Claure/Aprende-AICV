/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only heavy deps (e.g. puppeteer, if installed) out of the client bundle.
  experimental: {
    serverComponentsExternalPackages: ["puppeteer", "puppeteer-core", "openai"],
  },
};

export default nextConfig;
