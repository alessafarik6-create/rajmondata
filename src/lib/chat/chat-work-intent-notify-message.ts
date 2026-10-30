export function formatCsJobDate(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || "—";
  return `${m[3]}. ${m[2]}. ${m[1]}`;
}

export function formatCsJobDateRange(
  startDate?: string | null,
  endDate?: string | null
): string {
  const a = formatCsJobDate(startDate);
  const b = formatCsJobDate(endDate);
  if (a === "—" && b === "—") return "—";
  if (a !== "—" && b !== "—" && a !== b) {
    const yStart = /^(\d{2})\. (\d{2})\. (\d{4})$/.exec(a)?.[3];
    const yEnd = /^(\d{2})\. (\d{2})\. (\d{4})$/.exec(b)?.[3];
    if (yStart && yEnd && yStart === yEnd) {
      const d1 = /^(\d{2})\. (\d{2})/.exec(a);
      const d2 = /^(\d{2})\. (\d{2})/.exec(b);
      if (d1 && d2) return `${Number(d1[1])}. ${d1[2]}. – ${Number(d2[1])}. ${d2[2]}. ${yEnd}`;
    }
    return `${a} – ${b}`;
  }
  return a !== "—" ? a : b;
}

export function buildJobAssignmentMessageText(params: {
  jobNumber?: string | null;
  jobName: string;
  customerName: string;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  assignerLabel: string;
}): string {
  const lines = [
    "NOVÁ ZAKÁZKA",
    "",
    "Byla vám přiřazena zakázka:",
    "",
    ...(String(params.jobNumber ?? "").trim()
      ? [`Evidenční číslo: ${String(params.jobNumber).trim()}`, ""]
      : []),
    `Název: ${params.jobName}`,
    `Termín: ${formatCsJobDateRange(params.startDate, params.endDate)}`,
    `Zákazník: ${params.customerName || "—"}`,
  ];
  const note = String(params.note ?? "").trim();
  if (note) lines.push(`Pokyny: ${note}`);
  lines.push("", `Přiřadil: ${params.assignerLabel}`);
  return lines.join("\n");
}
