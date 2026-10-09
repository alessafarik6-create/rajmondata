/**
 * Oddělení importovaného typu (source_type) od ruční klasifikace (type_override).
 */

export type LeadTypeOverlayFields = {
  source_type?: string | null;
  type_override?: string | null;
  /** @deprecated používej type_override */
  typ_poptavky?: string | null;
  /** @deprecated používej type_override */
  inquiryTypeManual?: boolean;
  typ?: string | null;
};

export function readTypeOverride(
  overlay?: LeadTypeOverlayFields | Record<string, unknown> | null
): string | null {
  if (!overlay || typeof overlay !== "object") return null;
  const o = overlay as Record<string, unknown>;
  const direct = String(o.type_override ?? "").trim();
  if (direct) return direct;
  if (o.inquiryTypeManual === true) {
    const legacy = String(o.typ_poptavky ?? "").trim();
    if (legacy) return legacy;
  }
  return null;
}

export function hasPersistedTypeOverride(
  data?: Record<string, unknown> | null
): boolean {
  return readTypeOverride(data) != null;
}

export function readSourceType(
  row: { typ?: string },
  overlay?: LeadTypeOverlayFields | Record<string, unknown> | null
): string {
  const fromRow = String(row.typ ?? "").trim();
  if (fromRow) return fromRow;
  if (!overlay || typeof overlay !== "object") return "";
  const o = overlay as Record<string, unknown>;
  return (
    String(o.source_type ?? "").trim() ||
    String(o.typ ?? "").trim() ||
    String(o.typ_poptavky ?? "").trim()
  );
}
