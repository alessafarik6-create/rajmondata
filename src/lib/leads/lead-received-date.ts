import type { Timestamp } from "firebase/firestore";
import type { LeadImportRow } from "@/lib/lead-import-parse";

/** Časová zóna pro kalendářní den poptávky (ČR). */
export const LEADS_APP_TIMEZONE = "Europe/Prague";

export type LeadOverlayReceivedFields = {
  receivedAt?: unknown;
};

export function overlayReceivedDate(ov: LeadOverlayReceivedFields | undefined): Date | null {
  if (!ov) return null;
  const r = ov.receivedAt;
  if (
    r &&
    typeof r === "object" &&
    "toDate" in r &&
    typeof (r as Timestamp).toDate === "function"
  ) {
    return (r as Timestamp).toDate();
  }
  return null;
}

/** Stejný zdroj jako UI u řádku poptávky — import ISO, jinak overlay.receivedAt. */
export function leadReceivedDate(
  lead: LeadImportRow,
  ov: LeadOverlayReceivedFields | undefined
): Date | null {
  if (lead.receivedAtIso) {
    const d = new Date(lead.receivedAtIso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return overlayReceivedDate(ov);
}

/** Kalendářní den v Europe/Prague jako yyyy-MM-dd (lexikograficky porovnatelné). */
export function ymdInLeadsTimezone(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEADS_APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function leadReceivedYmd(
  lead: LeadImportRow,
  ov: LeadOverlayReceivedFields | undefined
): string | null {
  const d = leadReceivedDate(lead, ov);
  if (!d) return null;
  return ymdInLeadsTimezone(d);
}
