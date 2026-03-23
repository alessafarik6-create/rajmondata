import type { LeadImportRow } from "@/lib/lead-import-parse";

/** Query parametry pro /portal/jobs/measurements — předvyplnění z poptávky. */
export function buildMeasurementPrefillHref(lead: LeadImportRow): string {
  const params = new URLSearchParams();
  const name = String(lead.jmeno ?? "").trim();
  const phone = String(lead.telefon ?? "").trim();
  const address = String(lead.adresa ?? "").trim();
  const email = String(lead.email ?? "").trim();
  const zprava = String(lead.zprava ?? "").trim();

  if (name) params.set("prefillCustomerName", name);
  if (phone) params.set("prefillPhone", phone);
  if (address) params.set("prefillAddress", address);

  const noteParts: string[] = [];
  if (!address) {
    noteParts.push("Adresa v poptávce nebyla vyplněna — doplňte ji před uložením.");
  }
  if (email) noteParts.push(`E-mail: ${email}`);
  if (zprava) noteParts.push(zprava);
  if (noteParts.length) params.set("prefillNote", noteParts.join("\n\n"));

  const q = params.toString();
  return q ? `/portal/jobs/measurements?${q}` : "/portal/jobs/measurements";
}
