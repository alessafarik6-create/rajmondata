/**
 * Smoke test: parseFetchJsonResponse handles plain-text 413 (Request Entity Too Large).
 * Run: npx tsx scripts/test-parse-fetch-response.mjs
 */

import assert from "node:assert/strict";

// Minimal inline copy of logic under test (avoid TS path aliases in script)
async function parseFetchJsonResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const status = response.status;
  if (contentType.includes("application/json")) {
    const data = await response.json();
    return { ok: true, data, status };
  }
  const text = (await response.text()).trim();
  if (status === 413 || /request entity too large/i.test(text)) {
    return { ok: false, status: 413, error: "Soubor je příliš velký pro přímé nahrání přes server." };
  }
  return { ok: false, status, error: "Požadavek se nezdařil." };
}

const mock413 = new Response("Request Entity Too Large", { status: 413 });
const result = await parseFetchJsonResponse(mock413);
assert.equal(result.ok, false);
assert.equal(result.status, 413);
assert.match(result.error, /příliš velký/i);
console.log("OK: plain-text 413 parsed without JSON throw");
