/**
 * Zobrazení aktivního úseku práce na docházkovém terminálu (zakázka / tarif).
 * Sdílená logika klient (Firestore listener) + server (Admin SDK).
 */

export type TerminalActiveSegment = {
  sourceType: "job" | "tariff";
  jobId: string | null;
  jobName: string;
  tariffId: string | null;
  tariffName: string;
  displayName: string;
};

export function segmentStartMillisFromWorkSegmentData(data: Record<string, unknown>): number {
  const t = data.startAt as { toMillis?: () => number } | undefined;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  return 0;
}

/**
 * Při více otevřených segmentech (anomálie) dá přednost zakázce před tarifem,
 * u stejného typu vybere nejpozději zahájený.
 */
export function pickPreferredOpenWorkSegmentDoc<T extends { data: () => Record<string, unknown> }>(
  docs: T[]
): T | null {
  if (docs.length === 0) return null;
  if (docs.length === 1) return docs[0];
  const sorted = [...docs].sort(
    (a, b) =>
      segmentStartMillisFromWorkSegmentData(a.data()) -
      segmentStartMillisFromWorkSegmentData(b.data())
  );
  const jobs = sorted.filter((d) => String(d.data().sourceType || "") === "job");
  if (jobs.length > 0) return jobs[jobs.length - 1];
  const tariffs = sorted.filter((d) => String(d.data().sourceType || "") === "tariff");
  if (tariffs.length > 0) return tariffs[tariffs.length - 1];
  return sorted[sorted.length - 1];
}

export function workSegmentDataToTerminalActiveSegment(
  data: Record<string, unknown>
): TerminalActiveSegment {
  const st = data.sourceType === "tariff" ? "tariff" : "job";
  return {
    sourceType: st,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
    jobName: typeof data.jobName === "string" ? data.jobName : "",
    tariffId: typeof data.tariffId === "string" ? data.tariffId : null,
    tariffName: typeof data.tariffName === "string" ? data.tariffName : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "",
  };
}

/** Seskupí dokumenty work_segments podle employeeId a vybere zobrazený segment. */
/**
 * Stejné jako {@link buildTerminalActiveSegmentMapFromDocs}, vstup z `useCollection`
 * (`{ id, ...doc.data() }`).
 */
export function buildTerminalActiveSegmentMapFromRows(
  rows: Array<Record<string, unknown> & { id: string }>
): Map<string, TerminalActiveSegment> {
  const fakeDocs = rows.map((row) => {
    const { id, ...rest } = row;
    return {
      id,
      data: () => rest as Record<string, unknown>,
    };
  });
  return buildTerminalActiveSegmentMapFromDocs(fakeDocs);
}

/**
 * Řádek pod jméno na dashboardu: při aktivní zakázce zobrazí zakázku, při tarifu tarif (priorita job > tarif v datech segmentu).
 */
export function terminalActiveSegmentDashboardLabel(
  seg: TerminalActiveSegment | undefined
): string | null {
  if (!seg) return null;
  if (seg.sourceType === "tariff") {
    const n = seg.tariffName?.trim();
    return n ? `Tarif: ${n}` : "Tarif";
  }
  const jn = seg.jobName?.trim();
  if (jn) return `Zakázka: ${jn}`;
  const dn = seg.displayName?.trim();
  if (dn) return dn;
  return null;
}

/** Vyhledání otevřeného segmentu — `employeeId` v segmentu může být id dokumentu nebo Auth UID. */
export function getTerminalActiveSegmentForEmployee(
  map: Map<string, TerminalActiveSegment>,
  emp: { id: string; authUserId?: string | null }
): TerminalActiveSegment | undefined {
  const byDoc = map.get(emp.id);
  if (byDoc) return byDoc;
  const uid = emp.authUserId?.trim();
  if (uid) return map.get(uid);
  return undefined;
}

export function buildTerminalActiveSegmentMapFromDocs<T extends { id: string; data: () => Record<string, unknown> }>(
  docs: T[]
): Map<string, TerminalActiveSegment> {
  const byEmp = new Map<string, T[]>();
  for (const doc of docs) {
    const data = doc.data();
    const eid = typeof data.employeeId === "string" ? data.employeeId.trim() : "";
    if (!eid) continue;
    const list = byEmp.get(eid) ?? [];
    list.push(doc);
    byEmp.set(eid, list);
  }
  const out = new Map<string, TerminalActiveSegment>();
  for (const [eid, list] of byEmp) {
    const picked = pickPreferredOpenWorkSegmentDoc(list);
    if (picked) {
      out.set(eid, workSegmentDataToTerminalActiveSegment(picked.data()));
    }
  }
  return out;
}
