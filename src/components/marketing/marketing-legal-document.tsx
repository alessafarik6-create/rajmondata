import Link from "next/link";
import { MarketingBreadcrumbs } from "@/components/marketing/marketing-breadcrumbs";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

export function MarketingLegalDocument({ doc }: { doc: LegalDocumentRender }) {
  return (
    <article className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12 md:px-6">
      <MarketingBreadcrumbs
        items={[
          { label: "RAJMONDATA", href: "/" },
          { label: doc.meta.title },
        ]}
      />
      <h1 className="mt-4 text-3xl font-bold text-slate-50">{doc.meta.title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        Verze {doc.meta.version} · účinnost {doc.meta.effectiveDate} · aktualizace{" "}
        {doc.meta.lastUpdated}
      </p>

      <div className="prose prose-invert mt-8 max-w-none space-y-8 text-slate-300">
        {doc.sections.map((sec) => (
          <section key={sec.heading} id={sec.id}>
            <h2 className="text-xl font-semibold text-slate-100">{sec.heading}</h2>
            {sec.paragraphs?.map((p) => (
              <p key={p.slice(0, 40)} className="mt-3 text-sm leading-relaxed sm:text-base">
                {p}
              </p>
            ))}
            {sec.bullets ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm sm:text-base">
                {sec.bullets.map((b) => (
                  <li key={b.slice(0, 48)}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <p className="mt-10 text-sm text-slate-500">
        <Link href="/ochrana-osobnich-udaju" className="text-primary hover:underline">
          Zásady ochrany osobních údajů
        </Link>
        {" · "}
        <Link href="/cookies" className="text-primary hover:underline">
          Cookies
        </Link>
        {" · "}
        <Link href="/obchodni-podminky" className="text-primary hover:underline">
          Obchodní podmínky
        </Link>
      </p>
    </article>
  );
}
