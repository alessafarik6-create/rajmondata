"use client";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import type { CuttingPlanExcelExtension } from "@/lib/job-cutting-plan-excel-types";

/**
 * Nahraje Excel/CSV nářezového plánku beze změny binárního obsahu (vzorce zůstanou v souboru).
 * Cesta: companies/{companyId}/jobs/{jobId}/cuttingPlanExcel/{timestamp}_{safeName}
 */
export async function uploadJobCuttingPlanExcelFile(params: {
  companyId: string;
  jobId: string;
  file: File;
  extension: CuttingPlanExcelExtension;
}): Promise<{ fileUrl: string; storagePath: string; fileName: string }> {
  const storage = getFirebaseStorage();
  const safeName =
    String(params.file.name || "narezovy-planek")
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "narezovy-planek";
  const storagePath = `companies/${params.companyId}/jobs/${params.jobId}/cuttingPlanExcel/${Date.now()}_${safeName.replace(/[\\/]/g, "_")}`;
  const contentType =
    params.file.type?.trim() ||
    (params.extension === "csv"
      ? "text/csv"
      : params.extension === "xls"
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const r = ref(storage, storagePath);
  await uploadBytes(r, params.file, { contentType });
  const fileUrl = await getDownloadURL(r);
  return { fileUrl, storagePath, fileName: safeName };
}
