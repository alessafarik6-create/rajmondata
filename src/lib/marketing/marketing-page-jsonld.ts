import { MARKETING_PAGE_FAQ } from "@/lib/marketing/marketing-page-faq";
import type { MarketingPageDef } from "@/lib/marketing/public-pages-registry";
import { SITE_URL } from "@/lib/site-url";

export function buildMarketingPageJsonLd(page: MarketingPageDef, canonical: string): object[] {
  const breadcrumbLabel = page.breadcrumbLabel || page.h1;
  const out: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.h1,
      description: page.description,
      url: canonical,
      isPartOf: {
        "@type": "WebSite",
        name: "RAJMONDATA",
        url: `${SITE_URL}/`,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Domů",
          item: `${SITE_URL}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: breadcrumbLabel,
          item: canonical,
        },
      ],
    },
  ];

  const faq = MARKETING_PAGE_FAQ[page.slug];
  if (faq?.length) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    });
  }

  return out;
}
