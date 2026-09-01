/**
 * Diagnostika OpenAI Responses API + JSON schema (spusťte lokálně s OPENAI_API_KEY v .env.local).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
const model = String(process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim();

/** Původní (chybné) schema — unit/discount nejsou v required. */
const BROKEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    customer_requirements: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    recommended_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          catalog_id: { type: "string" },
          product_id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          discount: { type: "number" },
          reason: { type: "string" },
        },
        required: ["catalog_id", "product_id", "name", "quantity", "reason"],
      },
    },
    internal_notes: { type: "string" },
    customer_reply: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "summary",
    "customer_requirements",
    "missing_information",
    "recommended_items",
    "internal_notes",
    "customer_reply",
    "confidence",
  ],
};

/** Opravené schema — strict: true vyžaduje všechny properties v required. */
const FIXED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    customer_requirements: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    recommended_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          catalog_id: { type: "string" },
          product_id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          discount: { type: "number" },
          reason: { type: "string" },
        },
        required: [
          "catalog_id",
          "product_id",
          "name",
          "quantity",
          "unit",
          "discount",
          "reason",
        ],
      },
    },
    internal_notes: { type: "string" },
    customer_reply: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "summary",
    "customer_requirements",
    "missing_information",
    "recommended_items",
    "internal_notes",
    "customer_reply",
    "confidence",
  ],
};

async function probe(label, schema) {
  if (!apiKey) {
    console.log("SKIP: OPENAI_API_KEY not set");
    return;
  }
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: "Return minimal valid JSON for the schema.",
      input: "Test",
      text: {
        format: {
          type: "json_schema",
          name: "inquiry_quote_draft",
          strict: true,
          schema,
        },
      },
    }),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  console.log(`\n--- ${label} ---`);
  console.log("HTTP", res.status);
  if (data.error) {
    console.log("error.type:", data.error.type);
    console.log("error.code:", data.error.code);
    console.log("error.message:", data.error.message?.slice(0, 300));
  } else {
    console.log("OK, request_id:", data.id ?? "—");
  }
}

await probe("BROKEN schema", BROKEN_SCHEMA);
await probe("FIXED schema", FIXED_SCHEMA);
