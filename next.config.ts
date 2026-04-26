import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel-agnostic standalone build:
  // produces .next/standalone with a self-contained server.js, ready for
  // Docker/PM2 on Ubuntu VPS. Coolify can also pick it up.
  output: "standalone",
};

export default nextConfig;
