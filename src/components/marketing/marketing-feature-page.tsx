import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingBreadcrumbs } from "@/components/marketing/marketing-breadcrumbs";
import type { MarketingContentBlock, MarketingPageDef } from "@/lib/marketing/public-pages-registry";
import { getMarketingPageBySlug } from "@/lib/marketing/public-pages-registry";

function RenderBlock({ block }: { block: MarketingContentBlock }) {
  if (block.type === "h3") {
    return <h3 className="text-lg font-semibold text-slate-100">{block.text}</h3>;
  }
  if (block.type === "p") {
    return <p>{block.text}</p>;
  }
  return (
    <ul className="list-disc space-y-2 pl-5">
      {block.items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function MarketingFeaturePage({ page }: { page: MarketingPageDef }) {
  const related = (page.relatedSlugs ?? [])
    .map((s) => getMarketingPageBySlug(s))
    .filter(Boolean) as MarketingPageDef[];

  return (
    <article className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12 md:px-6">
      <MarketingBreadcrumbs
        items={[
          { label: "RAJMONDATA", href: "/" },
          { label: page.breadcrumbLabel || page.h1 },
        ]}
      />
      <h1 className="mt-4 text-balance text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
        {page.h1}
      </h1>
      {page.intro ? <p className="mt-4 text-base leading-relaxed text-slate-300">{page.intro}</p> : null}
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300 sm:text-base">
        {page.blocks?.map((b, i) => (
          <RenderBlock key={i} block={b} />
        ))}
      </div>

      {related.length > 0 ? (
        <section className="mt-10 border-t border-white/10 pt-8">
          <h2 className="text-lg font-semibold text-slate-100">Související témata</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/${r.slug}`}
                  className="rounded-full border border-white/15 bg-slate-900/60 px-3 py-1 text-sm text-slate-200 hover:border-primary/50"
                >
                  {r.h1}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/register">Vyzkoušet RAJMONDATA</Link>
        </Button>
        <Button size="lg" variant="outline" className="border-white/20 bg-white/5" asChild>
          <Link href="/funkce">Všechny funkce</Link>
        </Button>
      </div>
    </article>
  );
}
