import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/format-message-date.ts"), "utf8");
const dateSafe = readFileSync(join(root, "src/lib/date-safe.ts"), "utf8");

assert.match(lib, /export function formatMessageDate/, "formatMessageDate");
assert.match(lib, /MESSAGE_DATE_UNKNOWN/, "unknown label");
assert.match(dateSafe, /Neznámé datum/, "no bez data in date-safe");
assert.doesNotMatch(dateSafe, /bez data/, "removed bez data");

console.log("OK: test-format-message-date");
