import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel-compatible config — no standalone output (Vercel handles that) */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
