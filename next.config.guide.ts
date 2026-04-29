import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Isolates static chunks from the Main site.
  // Browser requests: /_next-guide/_next/static/...
  // Traefik strips /_next-guide → guide server receives /_next/static/... ✓
  assetPrefix: "/_next-guide",

  productionBrowserSourceMaps: false,
  compress: true,

  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },

  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{ kebabCase member }}",
      preventFullImport: true,
    },
  },

  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
  },

  typescript: {
    // Partial-route build: TS check is skipped entirely to save memory & time.
    // Type safety is enforced by the full build (Dockerfile / CI).
    ignoreBuildErrors: true,
  },

  experimental: {
    // Reduces peak Webpack memory if Turbopack is unavailable in this env.
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
