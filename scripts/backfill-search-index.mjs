/**
 * Backfill search index — volá admin API (vyžaduje Firebase ID token owner/admin).
 *
 * Usage:
 *   node scripts/backfill-search-index.mjs --companyId=ID --token=FIREBASE_ID_TOKEN
 *   node scripts/backfill-search-index.mjs --companyId=ID --token=TOKEN --baseUrl=http://localhost:9002
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const companyId = String(args.companyId ?? "").trim();
const token = String(args.token ?? process.env.SEARCH_BACKFILL_TOKEN ?? "").trim();
const baseUrl = String(args.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:9002").replace(/\/$/, "");
const skipEmbedding = args.skipEmbedding === "true";

if (!companyId) {
  console.error("Chybí --companyId=...");
  process.exit(1);
}
if (!token) {
  console.error("Chybí --token= (Firebase ID token owner/admin) nebo SEARCH_BACKFILL_TOKEN");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/company/search/backfill`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ companyId, skipEmbedding }),
});

const data = await res.json();
if (!res.ok) {
  console.error("Backfill failed:", data);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
console.log("Backfill hotovo.");
