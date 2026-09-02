import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Thetanuts SDK dynamically imports fs/promises (RFQ keystore only,
  // never used client-side). Stub it in browser bundles for both bundlers.
  turbopack: {
    resolveAlias: {
      "fs/promises": { browser: "./lib/empty-fs.ts" },
      fs: { browser: "./lib/empty-fs.ts" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        "fs/promises": false,
      };
    }
    return config;
  },
};

export default nextConfig;
