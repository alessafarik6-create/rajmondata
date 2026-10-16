import assert from "node:assert/strict";
import {
  buildCatalogLevelPdfStoragePath,
  buildProductLevelPdfStoragePath,
  customerVisiblePdfAttachments,
  serializePdfAttachmentsForFirestore,
} from "@/lib/product-catalogs";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("builds distinct storage paths for catalog vs product", () => {
  assert.equal(
    buildCatalogLevelPdfStoragePath("co1", "cat1", "doc1"),
    "companies/co1/catalogs/cat1/documents/doc1.pdf"
  );
  assert.equal(
    buildProductLevelPdfStoragePath("co1", "cat1", "prod1", "doc1"),
    "companies/co1/catalogs/cat1/products/prod1/documents/doc1.pdf"
  );
});

test("serializes mime type and customer visibility", () => {
  const rows = serializePdfAttachmentsForFirestore([
    {
      id: "a",
      fileName: "x.pdf",
      displayName: "X",
      storagePath: "p/x.pdf",
      sizeBytes: 100,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      customerVisible: true,
    },
  ]);
  assert.equal(rows[0]?.mimeType, "application/pdf");
  assert.equal(rows[0]?.customerVisible, true);
});

test("filters customer-visible attachments", () => {
  const visible = customerVisiblePdfAttachments([
    {
      id: "1",
      fileName: "a.pdf",
      displayName: "A",
      storagePath: "p/a.pdf",
      sizeBytes: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      customerVisible: true,
    },
    {
      id: "2",
      fileName: "b.pdf",
      displayName: "B",
      storagePath: "p/b.pdf",
      sizeBytes: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      customerVisible: false,
    },
  ]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, "1");
});
