/**
 * Dočasné uložení souboru „foto zaměření“ před otevřením editoru na detailu zakázky.
 * Pro přechod ze seznamu zakázek (Dialog) na `/portal/jobs/[jobId]?measurementPending=1` bez předčasného uploadu.
 */

const DB_NAME = "rajmondata-pending-job-measurement";
const STORE = "pending";
const KEY = "current";

type PendingRecord = {
  jobId: string;
  blob: Blob;
  name: string;
  type: string;
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function storePendingJobMeasurementFile(
  jobId: string,
  file: File
): Promise<void> {
  const db = await openDb();
  try {
    const rec: PendingRecord = {
      jobId: jobId.trim(),
      blob: file,
      name: file.name || "zamereni.jpg",
      type: file.type && file.type.startsWith("image/") ? file.type : "image/jpeg",
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.oncomplete = () => resolve();
      tx.objectStore(STORE).put(rec, KEY);
    });
  } finally {
    db.close();
  }
}

/** Načte a smaže záznam; vrátí File jen pokud jobId sedí. */
export async function takeAndClearPendingJobMeasurementFile(
  expectedJobId: string
): Promise<File | null> {
  const want = expectedJobId.trim();
  const db = await openDb();
  try {
    const rec = await new Promise<PendingRecord | undefined>((resolve, reject) => {
      let out: PendingRecord | undefined;
      const tx = db.transaction(STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"));
      tx.oncomplete = () => resolve(out);
      const store = tx.objectStore(STORE);
      const getReq = store.get(KEY);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        out = getReq.result as PendingRecord | undefined;
        store.delete(KEY);
      };
    });
    if (!rec || rec.jobId !== want || !rec.blob) return null;
    return new File([rec.blob], rec.name || "zamereni.jpg", { type: rec.type });
  } finally {
    db.close();
  }
}
