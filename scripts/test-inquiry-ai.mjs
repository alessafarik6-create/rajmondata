import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const required = [
  "src/lib/ai/openai-client.ts",
  "src/lib/ai/quote-generation-service.ts",
  "src/lib/ai/crm-context-builder.ts",
  "src/lib/ai/response-validator.ts",
  "src/lib/ai/inquiry-quote-system-prompt.ts",
  "src/app/api/company/inquiry-ai/generate-quote/route.ts",
  "src/app/api/company/inquiry-ai/mark-used/route.ts",
  "src/components/leads/inquiry-ai-quote-dialog.tsx",
];

for (const f of required) {
  if (!fs.existsSync(path.join(root, f))) {
    throw new Error(`missing file: ${f}`);
  }
}

const page = read("src/app/portal/leads/page.tsx");
const client = read("src/lib/ai/openai-client.ts");
const dialog = read("src/components/leads/inquiry-ai-quote-dialog.tsx");

if (!page.includes("InquiryAiQuoteButton")) {
  throw new Error("leads page must include AI button");
}
if (!page.includes("InquiryAiQuotePreviewDialog")) {
  throw new Error("leads page must include AI preview dialog");
}
if (client.includes("process.env.OPENAI_API_KEY") && dialog.includes("OPENAI_API_KEY")) {
  throw new Error("OPENAI_API_KEY must not appear in client components");
}
if (dialog.includes("OPENAI_API_KEY")) {
  throw new Error("API key leaked to client");
}
if (!read("firestore.rules").includes("ai_generations")) {
  throw new Error("firestore rules must include ai_generations");
}

console.log("test-inquiry-ai.mjs: OK");
