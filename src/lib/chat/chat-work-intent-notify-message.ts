export function formatCsJobDate(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || "—";
  return `${m[3]}. ${m[2]}. ${m[1]}`;
}

export function buildJobAssignmentMessageText(params: {
  jobName: string;
  customerName: string;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  assignerLabel: string;
}): string {
  const lines = [
    "Byla vám přiřazena nová zakázka.",
    "",
    `Název: ${params.jobName}`,
    `Zákazník: ${params.customerName || "—"}`,
    `Zahájení: ${formatCsJobDate(params.startDate)}`,
    `Dokončení: ${formatCsJobDate(params.endDate)}`,
  ];
  const note = String(params.note ?? "").trim();
  if (note) lines.push(`Poznámka: ${note}`);
  lines.push("", `Zakázku vám přiřadil ${params.assignerLabel}.`);
  return lines.join("\n");
}
