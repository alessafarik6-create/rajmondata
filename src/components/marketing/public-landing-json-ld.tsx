import { buildHomeJsonLd } from "@/lib/marketing/homepage-seo";
import { SITE_URL } from "@/lib/site-url";

export function PublicLandingJsonLd() {
  const graphs = buildHomeJsonLd(SITE_URL);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graphs) }}
    />
  );
}
