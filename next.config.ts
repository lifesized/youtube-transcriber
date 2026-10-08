import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.resolve(__dirname);

// One policy for every route; add directives here rather than a second
// Content-Security-Policy header, which browsers would enforce separately.
const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'"].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.prisma/**/*",
      "./node_modules/@prisma/client/**/*",
      "./node_modules/@prisma/adapter-better-sqlite3/**/*",
      "./node_modules/better-sqlite3/**/*",
      "./prisma/**/*",
    ],
  },
};

export default nextConfig;
