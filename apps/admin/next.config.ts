import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lint 统一由根目录 `pnpm lint`（turbo/eslint）执行，构建时不重复跑
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false }
};

export default nextConfig;
