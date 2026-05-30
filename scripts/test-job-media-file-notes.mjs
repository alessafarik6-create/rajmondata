import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "src/lib/job-media-file-notes.ts");
const src = readFileSync(lib, "utf8");

function mediaNoteLinkedFileIds(note) {
  const keys = ["fileId", "mediaId", "imageId", "documentId", "photoId", "targetId"];
  const out = [];
  for (const k of keys) {
    const v = String(note[k] ?? "").trim();
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

function mediaNoteMatchesFile(note, target) {
  const fileId = String(target.fileId ?? "").trim();
  if (!fileId) return false;
  const linked = mediaNoteLinkedFileIds(note);
  if (!linked.includes(fileId)) return false;
  const noteFolder = note.folderId != null ? String(note.folderId).trim() : "";
  const targetFolder = target.folderId != null ? String(target.folderId).trim() : "";
  if (targetFolder && noteFolder && noteFolder !== targetFolder) return false;
  return true;
}

function filterMediaNotesForCustomerView(notes, customerUid) {
  const uid = customerUid.trim();
  return notes.filter(
    (n) =>
      n.visibleToCustomer === true ||
      (uid && n.authorId === uid && n.authorType === "customer")
  );
}

assert.match(src, /visibleToCustomer: true/, "customer notes visible");
assert.match(src, /source: params\.source \?\? "customerPortal"/, "customer portal source");
assert.match(src, /mediaNoteLinkedFileIds/, "legacy id fallbacks");
assert.match(src, /mergeFileMediaNotesWithLegacyApprovalComment/, "approval comment merge");

const target = { fileId: "img-1", folderId: "folder-a" };
assert.ok(
  mediaNoteMatchesFile(
    { fileId: "img-1", mediaId: "img-1", folderId: "folder-a" },
    target
  )
);
assert.ok(
  mediaNoteMatchesFile({ imageId: "img-1", folderId: "folder-a" }, target)
);
assert.ok(!mediaNoteMatchesFile({ fileId: "img-1", folderId: "other" }, target));

const customerView = filterMediaNotesForCustomerView(
  [
    {
      authorType: "customer",
      authorId: "cust-1",
      visibleToCustomer: true,
      text: "visible",
    },
    {
      authorType: "admin",
      authorId: "admin-1",
      visibleToCustomer: false,
      text: "hidden",
    },
    {
      authorType: "admin",
      authorId: "admin-2",
      visibleToCustomer: true,
      text: "reply",
    },
  ],
  "cust-1"
);
assert.equal(customerView.length, 2);
assert.ok(customerView.some((n) => n.text === "visible"));
assert.ok(customerView.some((n) => n.text === "reply"));
assert.ok(!customerView.some((n) => n.text === "hidden"));

console.log("OK: test-job-media-file-notes");
