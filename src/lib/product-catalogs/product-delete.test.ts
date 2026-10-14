import assert from "node:assert/strict";
import {
  collectProductImageStoragePaths,
  firebaseStorageObjectPathFromDownloadUrl,
  planCatalogProductDeletion,
} from "./product-delete";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("storage path from firebase download URL", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/my-bucket/o/companies%2Fc1%2Fcatalog-products%2Fcat1%2Fphoto.jpg?alt=media&token=abc";
  assert.equal(
    firebaseStorageObjectPathFromDownloadUrl(url),
    "companies/c1/catalog-products/cat1/photo.jpg"
  );
});

test("remove product from array when no historical selection", () => {
  const products = [
    { id: "a", name: "A", order: 0 },
    { id: "b", name: "B", order: 1 },
  ];
  const plan = planCatalogProductDeletion(products, "a", false);
  assert.equal(plan.mode, "remove");
  assert.equal(plan.products.length, 1);
  assert.equal(plan.products[0]?.id, "b");
});

test("archive product when historical selection exists", () => {
  const products = [{ id: "a", name: "A", order: 0 }];
  const plan = planCatalogProductDeletion(products, "a", true);
  assert.equal(plan.mode, "archive");
  assert.equal(plan.products[0]?.archived, true);
  assert.equal(plan.products[0]?.active, false);
});

test("collect storage paths ignores bad URLs", () => {
  const paths = collectProductImageStoragePaths({
    id: "p1",
    name: "P",
    imageUrl: "https://example.com/x.jpg",
    gallery: [
      "https://firebasestorage.googleapis.com/v0/b/b/o/companies%2Fc%2Fx.jpg?alt=media",
    ],
  });
  assert.equal(paths.length, 1);
  assert.equal(paths[0], "companies/c/x.jpg");
});
