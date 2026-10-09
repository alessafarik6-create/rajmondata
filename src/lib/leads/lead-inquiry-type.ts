import type { InquiryTypeOverlayFields } from "@/lib/inquiry-type-badge";
import {
  readSourceType,
  readTypeOverride,
  type LeadTypeOverlayFields,
} from "@/lib/leads/lead-type-fields";

export type LeadInquiryTypeOverlay = InquiryTypeOverlayFields &
  LeadTypeOverlayFields;

/** Zobrazený / filtrovatelný typ — type_override má přednost před importem. */
export function resolveEffectiveInquiryType(
  row: { typ?: string },
  overlay?: LeadInquiryTypeOverlay | null
): string {
  const override = readTypeOverride(overlay);
  if (override) return override;
  const source = readSourceType(row, overlay);
  if (source) return source;
  return "Obecné";
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
