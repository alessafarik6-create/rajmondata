"use client";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";

/**
 * Nahraje PDF výrobního podkladu do Storage a vrátí veřejnou download URL.
 * Cesta: `companies/{companyId}/jobs/{jobId}/productionSheets/{fileName}`.
 */
export async function uploadProductionSheetPdfBlob(params: {
  companyId: string;
  jobId: string;
  fileName: string;
  blob: Blob;
}): Promise<{ fileUrl: string; storagePath: string }> {
  const storage = getFirebaseStorage();
  const safeName =
    String(params.fileName || "vyrobni-podklad.pdf")
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "vyrobni-podklad.pdf";
  const storagePath = `companies/${params.companyId}/jobs/${params.jobId}/productionSheets/${Date.now()}_${safeName.replace(/[\\/]/g, "_")}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, params.blob, { contentType: "application/pdf" });
  const fileUrl = await getDownloadURL(r);
  return { fileUrl, storagePath };
}
