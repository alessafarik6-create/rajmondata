import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "imapflow", "mailparser"],
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
  async headers() {
    return [
      {
        source: "/hikvision-jssdk/:path*.wasm",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
      {
        source: "/hikvision-jssdk/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }],
      },
    ];
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
      { source: "/gdpr", destination: "/ochrana-osobnich-udaju", permanent: true },
      { source: "/gdpr/:path*", destination: "/ochrana-osobnich-udaju", permanent: true },
      { source: "/evidence-dochazky", destination: "/dochazka-zamestnancu", permanent: true },
      { source: "/fakturace", destination: "/fakturace-a-doklady", permanent: true },
      { source: "/zakaznicky-portal", destination: "/komunikace-se-zakazniky", permanent: true },
      { source: "/vyroba-a-sklad", destination: "/sklad-a-vyroba", permanent: true },
      { source: "/software-pro-remeslniky", destination: "/pro-remeslniky", permanent: true },
      { source: "/software-pro-montazni-firmy", destination: "/pro-montazni-firmy", permanent: true },
      { source: "/portal/emails", destination: "/portal/email", permanent: false },
      { source: "/dochazkovy-system", destination: "/dochazka-zamestnancu", permanent: true },
      { source: "/skladova-evidence", destination: "/skladove-hospodarstvi", permanent: true },
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