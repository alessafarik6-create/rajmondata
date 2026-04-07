import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

const COUNTER_DOC_PATH_SEGMENTS = ["settings", "sodContractCounter"] as const;

/**
 * Atomically allocates the next "Smlouva o dílo" number for a company.
 * Format: SOD-YYYY-NNNN (year resets sequence).
 */
export async function allocateNextSodContractNumber(
  firestore: Firestore,
  companyId: string
): Promise<string> {
  const ref = doc(
    firestore,
    "companies",
    companyId,
    ...COUNTER_DOC_PATH_SEGMENTS
  );

  const year = new Date().getFullYear();

  const next = await runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(ref);
    let seq = 1;
    if (snap.exists()) {
      const data = snap.data() as { year?: number; seq?: number };
      if (data.year === year && typeof data.seq === "number") {
        seq = data.seq + 1;
      }
    }
    transaction.set(ref, {
      year,
      seq,
      updatedAt: serverTimestamp(),
    });
    return seq;
  });

  return `SOD-${year}-${String(next).padStart(4, "0")}`;
}

const SERIES_COUNTER_DOC_SEGMENTS = ["settings", "contractSeriesCounters"] as const;

/**
 * Atomically allocates the next document number for a custom series (e.g. RS, DOD).
 * Format: {SERIES}-YYYY-NNNN (per-series year reset).
 * SOD continues to use {@link allocateNextSodContractNumber} for backward compatibility.
 */
export async function allocateNextSeriesContractNumber(
  firestore: Firestore,
  companyId: string,
  seriesRaw: string
): Promise<string> {
  const normalized =
    String(seriesRaw || "GEN")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "GEN";

  const ref = doc(
    firestore,
    "companies",
    companyId,
    ...SERIES_COUNTER_DOC_SEGMENTS
  );

  const year = new Date().getFullYear();

  const next = await runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists()
      ? (snap.data() as {
          series?: Record<string, { year?: number; seq?: number }>;
        })
      : {};
    const seriesMap = { ...(data.series || {}) };
    const prev = seriesMap[normalized];
    let seq = 1;
    if (prev && prev.year === year && typeof prev.seq === "number") {
      seq = prev.seq + 1;
    }
    seriesMap[normalized] = { year, seq };
    transaction.set(ref, {
      series: seriesMap,
      updatedAt: serverTimestamp(),
    });
    return seq;
  });

  return `${normalized}-${year}-${String(next).padStart(4, "0")}`;
}
