import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/dashboard", destination: "/portal/dashboard", permanent: false },
      { source: "/employee", destination: "/portal/employee", permanent: false },
      { source: "/employee/:path*", destination: "/portal/employee/:path*", permanent: false },
      {
        source: "/portal/employee/work-log",
        destination: "/portal/employee/worklogs",
        permanent: false,
      },
      {
        source: "/portal/attendance/terminal-access/:token",
        destination: "/portal/attendance",
        permanent: false,
      },
      { source: "/terminal", destination: "/portal/attendance", permanent: false },
      { source: "/companies/:companyId/terminal", destination: "/portal/attendance", permanent: false },
      { source: "/portal/attendance/terminal", destination: "/portal/attendance", permanent: false },
      { source: "/portal/attendance/terminal/settings", destination: "/portal/attendance", permanent: false },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        port: "",
        pathname: "/**",
      }
    ],
  },
};

export default nextConfig;