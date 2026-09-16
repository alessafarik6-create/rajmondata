import type { Metadata } from "next";
import HomePageClient from "@/app/home-page-client";
import { SITE_URL } from "@/lib/site-url";
import {
  PLATFORM_DESCRIPTION,
  PLATFORM_METADATA_TITLE,
} from "@/lib/platform-brand";

export const metadata: Metadata = {
  title: PLATFORM_METADATA_TITLE,
  description: PLATFORM_DESCRIPTION,
  alternates: {
    canonical: `${SITE_URL}/`,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Home() {
  return <HomePageClient />;
}
