import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/terminal-active-segment.ts"), "utf8");
const page = readFileSync(join(root, "src/app/attendance-login/page.tsx"), "utf8");
const endRoute = readFileSync(join(root, "src/app/api/attendance-login/end-segment/route.ts"), "utf8");

assert.match(lib, /terminalEndActiveSegmentButtonLabel/, "button label helper");
assert.match(lib, /terminalActiveSegmentRunningLabel/, "running label helper");
assert.match(lib, /resolveTerminalActiveSegmentForEmployeeCard/, "card resolver");
assert.match(page, /scheduleReturnToSelection/, "returns to employee list after end");
assert.match(page, /await loadEmployees\(false\)/, "reloads employees before return");
assert.match(page, /bg-orange-500/, "visible orange button");
assert.match(page, /resolveTerminalActiveSegmentForEmployeeCard/, "card uses live resolver");
assert.match(endRoute, /closeAllOpenWorkSegmentsForEmployee/, "closes all open segments");
assert.match(endRoute, /clearEmployeeTerminalActiveSnapshot/, "clears employee snapshot");

function runningLabel(seg) {
  if (!seg) return null;
  if (seg.sourceType === "tariff") {
    const n = seg.tariffName?.trim() || seg.displayName?.trim() || "Tarif";
    return `Aktuálně běží tarif: ${n}`;
  }
  const jn = seg.jobName?.trim() || seg.displayName?.trim() || "Zakázka";
  return `Aktuálně běží zakázka: ${jn}`;
}

function endLabel(seg) {
  if (!seg) return "Ukončit aktivní úsek";
  if (seg.sourceType === "tariff") {
    const n = seg.tariffName?.trim() || seg.displayName?.trim() || "tarif";
    return `Ukončit tarif ${n}`;
  }
  return "Ukončit práci na zakázce";
}

assert.equal(
  runningLabel({ sourceType: "tariff", tariffName: "OBĚD" }),
  "Aktuálně běží tarif: OBĚD"
);
assert.equal(endLabel({ sourceType: "tariff", tariffName: "Cesta" }), "Ukončit tarif Cesta");

function resolveCard(emp, live, useApi) {
  if (!useApi) return live[emp.id] ?? null;
  return live[emp.id] ?? emp.activeSegment ?? null;
}

assert.equal(
  resolveCard({ id: "e1", activeSegment: { sourceType: "tariff", tariffName: "OBĚD" } }, {}, false),
  null,
  "live empty beats stale API"
);
assert.equal(
  resolveCard(
    { id: "e1", activeSegment: { sourceType: "tariff", tariffName: "OBĚD" } },
    { e1: { sourceType: "tariff", tariffName: "Cesta" } },
    false
  ).tariffName,
  "Cesta"
);

console.log("OK: test-attendance-terminal-end-tariff");
