import type { MetadataRoute } from "next";
import {
  PLATFORM_DESCRIPTION,
  PLATFORM_NAME,
} from "@/lib/platform-brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PLATFORM_NAME,
    short_name: PLATFORM_NAME,
    description: PLATFORM_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#f97316",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
