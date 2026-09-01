import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const schemaFile = readFile("src/lib/ai/inquiry-quote-schema.ts");
if (!schemaFile.includes('"unit"') || !schemaFile.includes('"discount"')) {
  throw new Error("schema must include unit and discount in item required");
}

// Dynamický import TS modulu není v .mjs — ověř strukturu regexem
const itemRequiredMatch = schemaFile.match(
  /recommended_items:[\s\S]*?required:\s*\[([\s\S]*?)\]\s*,?\s*\}\s*,/
);
if (!itemRequiredMatch || !itemRequiredMatch[1].includes('"unit"')) {
  throw new Error("recommended_items.required must list unit");
}
if (!itemRequiredMatch[1].includes('"discount"')) {
  throw new Error("recommended_items.required must list discount");
}

const client = readFile("src/lib/ai/openai-client.ts");
if (!client.includes("OpenAI API key is not configured")) {
  throw new Error("openai-client must log missing key safely");
}

const dialog = readFile("src/components/leads/inquiry-ai-quote-dialog.tsx");
if (!dialog.includes("mapInquiryAiUserErrorMessage")) {
  throw new Error("dialog must map user-facing errors");
}
if (dialog.includes("OPENAI_API_KEY")) {
  throw new Error("API key must not appear in client");
}

const page = readFile("src/app/portal/leads/page.tsx");
if (!page.includes("InquiryAiQuoteButton")) {
  throw new Error("leads page must include AI button");
}

console.log("test-inquiry-ai.mjs: OK");
