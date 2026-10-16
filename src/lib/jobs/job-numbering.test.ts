import {
  DEFAULT_JOB_NUMBERING_SETTINGS,
  formatJobNumberFromParts,
  parseJobNumberingSettings,
  resolveNumberingTypeForJobTag,
} from "@/lib/jobs/job-numbering";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const settings = parseJobNumberingSettings(DEFAULT_JOB_NUMBERING_SETTINGS);
const rd = resolveNumberingTypeForJobTag(settings, "Rodinný dům na klíč");
assert(rd.prefix === "RD", "RD prefix for rodinný");
const num = formatJobNumberFromParts("{PREFIX}-{YEAR}-{SEQ:3}", "RD", 2026, 1);
assert(num === "RD-2026-001", "format sample");
const zak = resolveNumberingTypeForJobTag(settings, "něco jiného");
assert(zak.prefix === "ZAK", "default ZAK");

console.log("ok job-numbering");
