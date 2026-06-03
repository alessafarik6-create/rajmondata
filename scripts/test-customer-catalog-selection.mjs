/**
 * Rychlý test logiky výběru produktů (bez Firestore).
 * node scripts/test-customer-catalog-selection.mjs
 */

function computeToggledSelection(catalog, productId, existingIds) {
  const mode = catalog.selectionMode === "single" ? "single" : "multi";
  const prev = new Set(existingIds);
  if (mode === "single") {
    if (prev.has(productId)) return [];
    return [productId];
  }
  if (prev.has(productId)) prev.delete(productId);
  else prev.add(productId);
  return Array.from(prev);
}

function buildSnapshots(catalog, selectedIds, existing, noteOverrides) {
  const products = catalog.products ?? [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const existingById = new Map((existing?.selectedProducts ?? []).map((s) => [s.productId, s]));
  const nowIso = "2026-05-19T12:00:00.000Z";
  return selectedIds.map((id) => {
    const p = byId.get(id);
    const prev = existingById.get(id);
    const override = noteOverrides?.[id];
    const customerNote =
      override !== undefined
        ? String(override ?? "").trim()
        : String(prev?.customerNote ?? "").trim();
    const out = {
      productId: id,
      productName: p?.name ?? id,
      catalogId: catalog.id,
      categoryId: p?.category ?? "",
      imageUrl: p?.imageUrl ?? "",
      selectedAt: prev?.selectedAt ?? nowIso,
    };
    if (customerNote) out.customerNote = customerNote;
    return out;
  });
}

const catalog = {
  id: "cat1",
  name: "Kuchyně",
  selectionMode: "multi",
  products: [
    { id: "p1", name: "Skříň", category: "Úložné", imageUrl: "https://x/1.jpg" },
    { id: "p2", name: "Stůl", category: "Nábytek", imageUrl: "https://x/2.jpg" },
  ],
};

let ok = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    ok++;
    console.log("OK:", msg);
  } else {
    fail++;
    console.error("FAIL:", msg);
  }
}

assert(
  JSON.stringify(computeToggledSelection(catalog, "p1", [])) === JSON.stringify(["p1"]),
  "vybrání produktu"
);
assert(
  JSON.stringify(computeToggledSelection(catalog, "p1", ["p1"])) === JSON.stringify([]),
  "odznačení produktu"
);
assert(
  JSON.stringify(computeToggledSelection(catalog, "p2", ["p1"])) === JSON.stringify(["p1", "p2"]),
  "druhý produkt v multi režimu"
);

const existing = {
  selectedProductIds: ["p1"],
  selectedProducts: [
    {
      productId: "p1",
      productName: "Skříň",
      customerNote: "Rohová",
      selectedAt: "2026-05-18T10:00:00.000Z",
    },
  ],
};
const afterDeselect = buildSnapshots(catalog, [], existing);
assert(afterDeselect.length === 0, "odznačení odstraní snapshoty");

const withNote = buildSnapshots(catalog, ["p1"], existing);
assert(withNote[0].customerNote === "Rohová", "zachování poznámky u vybraného");

const noteCleared = buildSnapshots(catalog, ["p1"], existing, { p1: "" });
assert(!noteCleared[0].customerNote, "prázdná poznámka se neukládá");

const newPick = buildSnapshots(catalog, ["p2"], undefined);
assert(newPick[0].productName === "Stůl" && newPick[0].catalogId === "cat1", "snapshot pole");

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
