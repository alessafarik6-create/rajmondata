import type { InquiryTypeOverlayFields } from "@/lib/inquiry-type-badge";
import { resolveInquiryTypeRaw } from "@/lib/inquiry-type-badge";

export type LeadInquiryTypeOverlay = InquiryTypeOverlayFields & {
  inquiryTypeManual?: boolean;
};

/** Zobrazený / filtrovatelný typ — ruční klasifikace má přednost před typem z importu. */
export function resolveEffectiveInquiryType(
  row: { typ?: string },
  overlay?: LeadInquiryTypeOverlay | null
): string {
  if (overlay?.inquiryTypeManual) {
    const manual = String(overlay.typ_poptavky ?? overlay.typ ?? "").trim();
    if (manual) return manual;
  }
  const raw = resolveInquiryTypeRaw(row, overlay);
  return raw?.trim() || "Obecné";
}

/** Sestaví seznam typů poptávek (import, overlay, pravidla AI). */
export function mergeTypOptionsFromRows<T extends { typ?: string }>(
  rows: T[],
  stableKey: (row: T) => string,
  overlayByKey: Map<string, LeadInquiryTypeOverlay | undefined>,
  ruleNames: string[]
): string[] {
  const s = new Set<string>();
  for (const name of ruleNames) {
    const t = String(name ?? "").trim();
    if (t) s.add(t);
  }
  for (const r of rows) {
    const fromRow = String(r.typ ?? "").trim();
    if (fromRow) s.add(fromRow);
    const ov = overlayByKey.get(stableKey(r));
    const effective = resolveEffectiveInquiryType(r, ov);
    if (effective) s.add(effective);
  }
  return [...s].sort((a, b) => a.localeCompare(b, "cs"));
}
