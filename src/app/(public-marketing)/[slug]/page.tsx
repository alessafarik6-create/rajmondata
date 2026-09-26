import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingFeaturePage } from "@/components/marketing/marketing-feature-page";
import { MarketingLegalDocument } from "@/components/marketing/marketing-legal-document";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { loadPublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { resolveLegalDocument } from "@/lib/marketing/legal/resolve-legal-document";
import {
  getAllMarketingSlugs,
  getMarketingPageBySlug,
} from "@/lib/marketing/public-pages-registry";
import {
  loadPublicPageSeoOverrides,
  mergePageSeo,
} from "@/lib/marketing/public-page-seo-server";
import { buildMarketingPageJsonLd } from "@/lib/marketing/marketing-page-jsonld";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-static";

export async function generateStaticParams() {
  return getAllMarketingSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getMarketingPageBySlug(slug);
  if (!page) return {};

  const overrides = await loadPublicPageSeoOverrides();
  const seo = mergePageSeo(page, overrides[slug]);

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "cs_CZ",
      url: seo.canonical,
      title: seo.ogTitle,
      description: seo.ogDescription,
      images: [{ url: seo.ogImage, width: 512, height: 512, alt: page.h1 }],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle,
      description: seo.ogDescription,
      images: [seo.ogImage],
    },
  };
}

export default async function PublicMarketingPage({ params }: Props) {
  const { slug } = await params;
  const page = getMarketingPageBySlug(slug);
  if (!page) notFound();

  const operator = await loadPublicOperatorInfo();

  const overrides = await loadPublicPageSeoOverrides();
  const merged = mergePageSeo(page, overrides[slug]);
  const jsonLdGraphs =
    page.kind === "legal" ? null : buildMarketingPageJsonLd(page, merged.canonical);

  return (
    <MarketingPageShell contactEmail={operator.email || null}>
      {jsonLdGraphs?.map((graph, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
        />
      ))}
      {page.kind === "legal" && page.legalKey ? (
        <MarketingLegalDocument doc={resolveLegalDocument(page.legalKey, operator)} />
      ) : (
        <MarketingFeaturePage page={page} />
      )}
    </MarketingPageShell>
  );
}
