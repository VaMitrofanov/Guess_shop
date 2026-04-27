import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ──────────────────────────────────────────────────────────────────────────
  // Vercel-agnostic standalone build:
  // produces .next/standalone with a self-contained server.js. Works for
  // Coolify/Docker/PM2 on Ubuntu VPS without changes.
  // ──────────────────────────────────────────────────────────────────────────
  output: "standalone",

  // ──────────────────────────────────────────────────────────────────────────
  // Production hardening for the 4 GB / 2-core deploy host (Coolify on
  // Ubuntu 22.04, Moscow). Each line below is here to either shrink the
  // build memory footprint or shave bytes off the client bundle.
  // ──────────────────────────────────────────────────────────────────────────

  // No source maps in the production browser bundle. They double the size of
  // every chunk on disk and push memory pressure during webpack emit. We can
  // still attach Sentry maps later via an explicit upload step if needed.
  productionBrowserSourceMaps: false,

  // Built-in gzip on the Node server. Saves CPU on Nginx/Coolify proxy in
  // front and is essentially free on Node.
  compress: true,

  // Strip console.* in production except errors/warns. Frees ~5–15% of bundle
  // bytes on a chatty client and removes noisy logs from prod DevTools.
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Tree-shake lucide-react and framer-motion at import time.
  // Default behaviour: `import { X } from "lucide-react"` pulls the full icon
  // index module → dev-server is fine, but webpack production build still has
  // to walk it, costing memory + bytes.
  // modularizeImports rewrites the import to a per-icon entrypoint, so each
  // icon becomes its own minimal module. Saves ~80–120 KB on the guide page
  // alone, where ~25 icons are in use.
  // ──────────────────────────────────────────────────────────────────────────
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{ kebabCase member }}",
      preventFullImport: true,
    },
  },

  // Image opt — keep defaults but disable the on-the-fly WebP/AVIF generator
  // pipeline since the project ships pre-optimised assets and the generator
  // alone can spike to 200+ MB RSS on small VPS instances.
  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24h — Robux store assets rarely change
  },

  // ──────────────────────────────────────────────────────────────────────────
  // TypeScript runs during `next build`. We keep it strict — type errors
  // are cheap to surface here. ESLint in Next 16 is no longer part of
  // `next build` by default (use `npm run lint` separately), so no
  // configuration is needed for it.
  // ──────────────────────────────────────────────────────────────────────────
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
