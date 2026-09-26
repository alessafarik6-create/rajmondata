import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/portal/",
        "/admin/",
        "/api/",
        "/auth/",
        "/login",
        "/register",
        "/attendance-login",
        "/reset-password",
        "/dashboard",
        "/employee/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
