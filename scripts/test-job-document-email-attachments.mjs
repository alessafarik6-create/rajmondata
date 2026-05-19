/**
 * Smoke test: parsování referencí příloh pro e-mail ze zakázky.
 * node scripts/test-job-document-email-attachments.mjs
 */

import assert from "node:assert/strict";

const MAX = 15;

function parseJobDocumentEmailAttachmentRefs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "").trim();
    const sourceId = String(item.sourceId ?? "").trim();
    const kind = String(item.kind ?? "").trim();
    const filename = String(item.filename ?? "").trim();
    const sourceLabel = String(item.sourceLabel ?? "").trim();
    if (!id || !sourceId || !filename) continue;
    if (!["work_contract_pdf", "company_document", "production_sheet"].includes(kind)) continue;
    out.push({ id, kind, sourceId, filename, sourceLabel });
  }
  return out.slice(0, MAX);
}

function attachmentRefsFromOptions(options, selectedIds) {
  return options
    .filter((o) => selectedIds.has(o.id))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      sourceId: o.sourceId,
      filename: o.filename,
      sourceLabel: o.sourceLabel,
    }));
}

const options = [
  {
    id: "wc-1",
    kind: "work_contract_pdf",
    sourceId: "c1",
    filename: "smlouva-001.pdf",
    sourceLabel: "Příloha ke smlouvě",
  },
  {
    id: "doc-2",
    kind: "company_document",
    sourceId: "d2",
    filename: "vykres.pdf",
    sourceLabel: "Dokument zakázky",
  },
];

assert.deepEqual(parseJobDocumentEmailAttachmentRefs(null), []);
assert.deepEqual(parseJobDocumentEmailAttachmentRefs([{ id: "x" }]), []);

const parsed = parseJobDocumentEmailAttachmentRefs([
  {
    id: "wc-1",
    kind: "work_contract_pdf",
    sourceId: "c1",
    filename: "a.pdf",
    sourceLabel: "Smlouva",
  },
]);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].filename, "a.pdf");

const refs = attachmentRefsFromOptions(options, new Set(["doc-2"]));
assert.equal(refs.length, 1);
assert.equal(refs[0].filename, "vykres.pdf");

console.log("test-job-document-email-attachments.mjs: OK");
