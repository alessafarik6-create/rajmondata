"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MARKETING_PAGES } from "@/lib/marketing/public-pages-registry";
import type { SanitizedPublicPageSeo } from "@/lib/platform-seo-public-pages-sanitize";

type Row = SanitizedPublicPageSeo[string];

export function AdminPublicPageSeoFields({
  selectedSlug,
  onSelectSlug,
  value,
  onChange,
}: {
  selectedSlug: string;
  onSelectSlug: (slug: string) => void;
  value: SanitizedPublicPageSeo;
  onChange: (next: SanitizedPublicPageSeo) => void;
}) {
  const page = MARKETING_PAGES.find((p) => p.slug === selectedSlug);
  const row: Row = value[selectedSlug] ?? {};
  const previewTitle = row.title?.trim() || page?.title || "Název stránky";
  const previewDesc =
    row.description?.trim() || page?.description || "Popis stránky se zobrazí zde…";

  const patch = (patchRow: Row) => {
    onChange({ ...value, [selectedSlug]: { ...row, ...patchRow } });
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <Label>Veřejná podstránka</Label>
        <select
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={selectedSlug}
          onChange={(e) => onSelectSlug(e.target.value)}
        >
          {MARKETING_PAGES.map((p) => (
            <option key={p.slug} value={p.slug}>
              /{p.slug} — {p.h1.slice(0, 48)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Výchozí texty jsou v kódu; vyplněná pole je přepíší. Homepage: canonical výchozí{" "}
          <code className="text-[11px]">https://rajmondata.cz/</code>
        </p>
      </div>
      <div className="space-y-1">
        <Label>Title</Label>
        <Input
          className="bg-white"
          value={row.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={page?.title}
        />
      </div>
      <div className="space-y-1">
        <Label>Meta description</Label>
        <Textarea
          className="bg-white"
          rows={2}
          value={row.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={page?.description}
        />
      </div>
      <div className="space-y-1">
        <Label>Canonical URL</Label>
        <Input
          className="bg-white"
          value={row.canonical ?? ""}
          onChange={(e) => patch({ canonical: e.target.value })}
          placeholder={`https://rajmondata.cz/${selectedSlug}`}
        />
      </div>
      <div className="space-y-1">
        <Label>OG title</Label>
        <Input
          className="bg-white"
          value={row.ogTitle ?? ""}
          onChange={(e) => patch({ ogTitle: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label>OG description</Label>
        <Textarea
          className="bg-white"
          rows={2}
          value={row.ogDescription ?? ""}
          onChange={(e) => patch({ ogDescription: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label>OG image URL</Label>
        <Input
          className="bg-white"
          value={row.ogImage ?? ""}
          onChange={(e) => patch({ ogImage: e.target.value })}
          placeholder="https://rajmondata.cz/pwa-512.png"
        />
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">Náhled Google (přibližně)</p>
        <p className="mt-2 text-lg text-[#1a0dab] leading-snug">{previewTitle.slice(0, 60)}</p>
        <p className="text-sm text-[#006621]">rajmondata.cz › {selectedSlug}</p>
        <p className="mt-1 text-sm text-slate-600 line-clamp-2">{previewDesc.slice(0, 160)}</p>
      </div>
    </div>
  );
}
