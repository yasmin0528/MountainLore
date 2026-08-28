import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.24.192.1"],
  async rewrites() {
    const backendApi = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000/api";
    return [{ source: "/api/:path*", destination: `${backendApi}/:path*` }];
  },
};

export default nextConfig;
