/**
 * Test skript pro AI analýzu dokladů (statická kontrola).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

for (const rel of [
  "src/lib/ai/document-extraction-schema.ts",
  "src/lib/ai/openai-document-client.ts",
  "src/lib/ai/document-extraction-service.ts",
  "src/lib/ai/document-extraction-validator.ts",
  "src/app/api/company/documents/analyze/route.ts",
  "src/components/documents/document-ai-scan-section.tsx",
]) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`missing ${rel}`);
}

const config = read("src/lib/ai/config.ts");
if (!config.includes("OPENAI_DOCUMENT_MODEL") || !config.includes("getOpenAiDocumentModel")) {
  throw new Error("config must define OPENAI_DOCUMENT_MODEL");
}

const client = read("src/lib/ai/openai-document-client.ts");
if (!client.includes("OpenAI API key is not configured")) {
  throw new Error("document client must log missing key safely");
}
if (client.includes("process.env.OPENAI_API_KEY")) {
  /* ok server only */
}

const scan = read("src/components/documents/document-ai-scan-section.tsx");
if (scan.includes("OPENAI_API_KEY")) {
  throw new Error("API key must not appear in client scan section");
}
if (!scan.includes('capture="environment"')) {
  throw new Error("camera input must use capture=environment");
}
if (!scan.includes("/api/company/documents/analyze")) {
  throw new Error("scan must call backend analyze API");
}

const page = read("src/app/portal/documents/page.tsx");
if (!page.includes("DocumentAiScanSection")) {
  throw new Error("documents page must integrate AI scan");
}
if (!page.includes("Uložit a přiřadit k zakázce")) {
  throw new Error("documents page must have save-and-assign button");
}

const validator = read("src/lib/ai/document-extraction-validator.ts");
if (!validator.includes("Částky na dokladu se nepodařilo jednoznačně ověřit")) {
  throw new Error("validator must check amount consistency");
}

console.log("test-document-ai.mjs: OK");
