import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local browser access explicit so Next's dev-only assets (including
  // the font endpoint and hot-reload resources) are never rejected as
  // cross-origin requests during local development.
  allowedDevOrigins: ["localhost", "127.0.0.1", "172.24.192.1", "192.168.225.1"],
  async rewrites() {
    const backendApi = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000/api";
    return [{ source: "/api/:path*", destination: `${backendApi}/:path*` }];
  },
};

export default nextConfig;
