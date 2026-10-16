import {
  buildEmployeeNameMap,
  enrichPreliminaryDealRowResponsibleName,
  mapEmployeesToPreliminaryDealOptions,
  resolvePreliminaryDealResponsibleName,
} from "@/lib/leads/preliminary-deal-employees";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const raw = [
  { id: "e1", firstName: "Jan", lastName: "Novák", isActive: true },
  { id: "e2", firstName: "Petr", lastName: "Svoboda", isActive: true },
  { id: "e3", isActive: true, email: "bez.jmena@firma.cz" },
  { id: "e4", isActive: false, firstName: "Martin", lastName: "Dvořák" },
];

const options = mapEmployeesToPreliminaryDealOptions(raw, { alsoIncludeIds: ["e4"] });
assert(options.some((o) => o.id === "e1" && o.name === "Jan Novák"), "Jan Novák");
assert(options.some((o) => o.id === "e2" && o.name === "Petr Svoboda"), "Petr Svoboda");
assert(!options.some((o) => o.id === "e3" && o.name === "Zaměstnanec"), "no generic fallback");
assert(options.find((o) => o.id === "e3")?.name === "bez.jmena@firma.cz", "email fallback");

const map = buildEmployeeNameMap(options);
assert(
  resolvePreliminaryDealResponsibleName(
    { responsibleEmployeeId: "e1", responsibleEmployeeName: "Zaměstnanec" },
    map
  ) === "Jan Novák",
  "prefer map over stale Zaměstnanec"
);

const enriched = enrichPreliminaryDealRowResponsibleName(
  { id: "d1", responsibleEmployeeId: "e2", responsibleEmployeeName: null },
  map
);
assert(enriched.responsibleEmployeeName === "Petr Svoboda", "enrich row");

console.log("ok preliminary-deal-employees");
