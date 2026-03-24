/**
 * Štítky / typ zakázky — uložené v poli `jobTag` na dokumentu zakázky.
 * Hodnoty jsou krátké identifikátory (např. pergola); zobrazení přes `jobTagLabel`.
 */

export const JOB_TAG_CUSTOM_VALUE = "__custom__";

export const JOB_TAG_PRESETS: readonly { value: string; label: string }[] = [
  { value: "pergola", label: "Pergola" },
  { value: "domy", label: "Domy" },
  { value: "zimni_zahrada", label: "Zimní zahrada" },
  { value: "ostatni", label: "Ostatní" },
];

export function jobTagLabel(value: string | undefined | null): string {
  if (value == null || typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  const hit = JOB_TAG_PRESETS.find((p) => p.value === v);
  return hit ? hit.label : v;
}

/** Pro filtr: předvolby + unikátní hodnoty ze zakázek (řazeno). */
export function collectJobTagFilterOptions(
  jobs: { jobTag?: string | null }[]
): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const p of JOB_TAG_PRESETS) {
    seen.add(p.value);
    out.push({ value: p.value, label: p.label });
  }
  const extra: string[] = [];
  for (const j of jobs) {
    const t = j?.jobTag;
    if (typeof t !== "string") continue;
    const s = t.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    extra.push(s);
  }
  extra.sort((a, b) => a.localeCompare(b, "cs"));
  for (const s of extra) {
    out.push({ value: s, label: s });
  }
  return out;
}
