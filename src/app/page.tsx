import type { Metadata } from "next";
import HomeAuthGate from "@/components/marketing/home-auth-gate";
import { PublicLandingJsonLd } from "@/components/marketing/public-landing-json-ld";
import { PublicLandingPage } from "@/components/marketing/public-landing-page";
import { SITE_URL } from "@/lib/site-url";
import {
  HOME_SEO_DESCRIPTION,
  HOME_SEO_TITLE,
} from "@/lib/marketing/homepage-seo";

const OG_IMAGE = `${SITE_URL}/pwa-512.png`;

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: HOME_SEO_TITLE,
  description: HOME_SEO_DESCRIPTION,
  alternates: {
    canonical: `${SITE_URL}/`,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "cs_CZ",
    url: `${SITE_URL}/`,
    siteName: "RAJMONDATA",
    title: HOME_SEO_TITLE,
    description: HOME_SEO_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 512,
        height: 512,
        alt: "RAJMONDATA — firemní portál pro zakázky a řízení firmy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_SEO_TITLE,
    description: HOME_SEO_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function Home() {
  return (
    <>
      <PublicLandingJsonLd />
      <HomeAuthGate>
        <PublicLandingPage />
      </HomeAuthGate>
    </>
  );
}
