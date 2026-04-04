import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // In development, proxy /api/* to the production backend so the browser
    // sees same-origin requests and auth cookies work correctly.
    if (process.env.NEXT_PUBLIC_APP_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: "https://expenses.chaitanya-gvs.com/api/:path*",
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
