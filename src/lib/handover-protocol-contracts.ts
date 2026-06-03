import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";

export function safeWorkContractsList(input: unknown): WorkContractDoc[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (c): c is WorkContractDoc =>
      !!c &&
      typeof c === "object" &&
      typeof (c as WorkContractDoc).id === "string" &&
      String((c as WorkContractDoc).id).trim().length > 0
  );
}

/** Smlouvy vhodné pro předávací protokol (ne dodatek / příloha / šablona). */
export function handoverEligibleContracts(
  workContracts: unknown
): Array<{ id: string; doc: WorkContractDoc; label: string }> {
  return safeWorkContractsList(workContracts)
    .filter((c) => {
      const role = String(c.documentRole ?? "").trim();
      return role !== "attachment" && role !== "addendum" && c.isTemplate !== true;
    })
    .map((c) => ({
      id: String(c.id).trim(),
      doc: c,
      label: `${String(c.contractNumber ?? c.id)} — ${String(
        c.documentTitle ?? c.title ?? "Smlouva o dílo"
      )}`,
    }));
}

export function pickDefaultHandoverContractId(
  workContracts: unknown,
  preferredId?: string | null
): string | null {
  const options = handoverEligibleContracts(workContracts);
  if (!options.length) return null;
  const pref = String(preferredId ?? "").trim();
  if (pref && options.some((o) => o.id === pref)) return pref;
  return options[0]!.id;
}
