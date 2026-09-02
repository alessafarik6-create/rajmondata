/**
 * Diagnostika CRM vyhledávání — počty entit vs search_index.
 * Usage: node scripts/diagnose-search.mjs [--companyId=ID]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const companyIdArg = process.argv.find((a) => a.startsWith("--companyId="))?.split("=")[1]?.trim();

const COLLECTIONS = {
  document: "documents",
  invoice: "invoices",
  offer: "inquiry_offers",
  inquiry: "import_lead_overlays",
  job: "jobs",
  customer: "customers",
  product: "product_catalogs",
};

async function countCol(db, companyId, sub) {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection(sub)
    .count()
    .get()
    .catch(async () => {
      const s = await db.collection("companies").doc(companyId).collection(sub).limit(500).get();
      return { data: () => ({ count: s.size }) };
    });
  return snap.data().count ?? 0;
}

async function countSearchIndex(db, companyId) {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("search_index")
    .get()
    .catch(() => null);
  if (!snap) return { total: 0, byType: {} };
  const byType = {};
  for (const d of snap.docs) {
    const t = String(d.data()?.entityType ?? "unknown");
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { total: snap.size, byType };
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("Chybí Firebase Admin credentials v .env.local");
    process.exit(1);
  }

  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  const db = getFirestore();
  let companyIds = [];

  if (companyIdArg) {
    companyIds = [companyIdArg];
  } else {
    const snap = await db.collection("companies").limit(10).get();
    companyIds = snap.docs.map((d) => d.id);
    console.log("Nalezené firmy (max 10):", companyIds.join(", ") || "(žádné)");
  }

  for (const companyId of companyIds) {
    console.log("\n========== companyId:", companyId, "==========");
    for (const [type, col] of Object.entries(COLLECTIONS)) {
      const n = await countCol(db, companyId, col);
      console.log(`  ${type} (${col}): ${n}`);
    }
    const idx = await countSearchIndex(db, companyId);
    console.log(`  search_index TOTAL: ${idx.total}`);
    for (const [t, c] of Object.entries(idx.byType)) {
      console.log(`    ${t}: ${c}`);
    }
    if (idx.total === 0) {
      console.log("  ⚠ search_index je PRÁZDNÝ — backfill nebyl spuštěn");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
