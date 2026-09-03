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
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_BUILD_COMMIT: appBuildCommit,
    NEXT_PUBLIC_APP_BUILD_TIMESTAMP: appBuildTimestamp
  }
};

export default nextConfig;
