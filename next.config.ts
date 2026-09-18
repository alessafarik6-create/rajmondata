import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "imapflow", "mailparser"],
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
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
      { source: "/dochazka-zamestnancu", destination: "/evidence-dochazky", permanent: true },
      { source: "/fakturace-a-doklady", destination: "/fakturace", permanent: true },
      { source: "/zakaznicky-portal", destination: "/komunikace-se-zakazniky", permanent: true },
      { source: "/vyroba-a-sklad", destination: "/sklad-a-vyroba", permanent: true },
      { source: "/software-pro-remeslniky", destination: "/pro-remeslniky", permanent: true },
      { source: "/software-pro-montazni-firmy", destination: "/pro-montazni-firmy", permanent: true },
      { source: "/portal/emails", destination: "/portal/email", permanent: false },
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