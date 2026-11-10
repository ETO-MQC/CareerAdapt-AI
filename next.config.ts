// next.config.ts
import path from "path";
import type { NextConfig } from "next";

const appBuildCommit = process.env.NEXT_PUBLIC_APP_BUILD_COMMIT?.trim()
  || process.env.APP_BUILD_COMMIT?.trim()
  || process.env.GIT_COMMIT_SHA?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  || "workspace-source";

const appBuildTimestamp = process.env.NEXT_PUBLIC_APP_BUILD_TIMESTAMP?.trim()
  || process.env.APP_BUILD_TIMESTAMP?.trim()
  || (process.env.NODE_ENV === "production" ? new Date().toISOString() : "development");

const nextConfig: NextConfig = {
  distDir: process.env.CAREERAD_NEXT_DIST_DIR?.trim() || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist"],
  reactStrictMode: true,

  // 显式指定 Turbopack 的根目录，覆盖 pnpm 在 Windows 上指向全局存储的符号链接
  turbopack: {
    root: path.join(process.cwd(), ".."),
  },

  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  env: {
    NEXT_PUBLIC_APP_BUILD_COMMIT: appBuildCommit,
    NEXT_PUBLIC_APP_BUILD_TIMESTAMP: appBuildTimestamp,
  },
};

export default nextConfig;