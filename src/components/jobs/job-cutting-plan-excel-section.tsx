"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  doc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { deleteObject, getBytes, ref as storageRef } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { useDoc, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import {
  CUTTING_PLAN_EXCEL_ACCEPT,
  JOB_CUTTING_PLAN_EXCEL_DOC_ID,
  formatCuttingPlanUploadedAt,
  isAllowedCuttingPlanExcelFile,
  inferCuttingPlanExtension,
  parseJobCuttingPlanExcelDoc,
  type JobCuttingPlanExcelDoc,
} from "@/lib/job-cutting-plan-excel-types";
import { uploadJobCuttingPlanExcelFile } from "@/lib/job-cutting-plan-excel-upload";
import {
  parseCuttingPlanExcelBytes,
  type CuttingPlanPreviewData,
} from "@/lib/job-cutting-plan-excel-preview";
import {
  FileSpreadsheet,
  Loader2,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  FileDown,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Props = {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  user: { uid: string; email?: string | null };
  authorName: string;
  canManage: boolean;
  canView: boolean;
};

export function JobCuttingPlanExcelSection(props: Props) {
  const { firestore, companyId, jobId, user, authorName, canManage, canView } = props;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const docRef = useMemoFirebase(
    () =>
      doc(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "cuttingPlanExcel",
        JOB_CUTTING_PLAN_EXCEL_DOC_ID
      ),
    [firestore, companyId, jobId]
  );
  const { data: rawDoc, isLoading } = useDoc(docRef);
  const planDoc = parseJobCuttingPlanExcelDoc(
    (rawDoc as Record<string, unknown> | null) ?? null,
    JOB_CUTTING_PLAN_EXCEL_DOC_ID
  );

  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<CuttingPlanPreviewData | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);

  const loadPreview = useCallback(async (meta: JobCuttingPlanExcelDoc) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const storage = getFirebaseStorage();
      const bytes = await getBytes(storageRef(storage, meta.storagePath));
      const parsed = parseCuttingPlanExcelBytes(bytes, meta.extension);
      setPreviewData(parsed);
      setActiveSheet(0);
    } catch (e) {
      console.error("[CuttingPlanExcel] preview failed", e);
      setPreviewData(null);
      setPreviewError(
        e instanceof Error
          ? e.message
          : "Náhled se nepodařilo načíst. Soubor lze stáhnout a otevřít v Excelu."
      );
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!planDoc || !canView) {
      setPreviewData(null);
      setPreviewError(null);
      return;
    }
    if (previewOpen) void loadPreview(planDoc);
  }, [planDoc, canView, previewOpen, loadPreview]);

  const persistDoc = async (
    upload: { fileUrl: string; storagePath: string; fileName: string },
    file: File,
    extension: NonNullable<ReturnType<typeof inferCuttingPlanExtension>>
  ) => {
    await setDoc(
      docRef,
      {
        companyId,
        jobId,
        fileName: upload.fileName,
        fileUrl: upload.fileUrl,
        storagePath: upload.storagePath,
        mimeType: file.type?.trim() || "",
        fileSize: file.size,
        extension,
        uploadedBy: user.uid,
        uploadedByName: authorName,
        uploadedByEmail: user.email?.trim() || null,
        updatedAt: serverTimestamp(),
        ...(planDoc ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  };

  const removeOldStorage = async (path: string | undefined) => {
    const p = path?.trim();
    if (!p) return;
    try {
      await deleteObject(storageRef(getFirebaseStorage(), p));
    } catch (e) {
      console.warn("[CuttingPlanExcel] old storage delete skipped", e);
    }
  };

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !canManage) return;
    if (!isAllowedCuttingPlanExcelFile(file)) {
      toast({
        variant: "destructive",
        title: "Neplatný soubor",
        description: "Povolené formáty: .xlsx, .xls, .csv (max. 20 MB).",
      });
      return;
    }
    const extension = inferCuttingPlanExtension(file);
    if (!extension) return;

    setUploading(true);
    const previousPath = planDoc?.storagePath;
    try {
      const uploaded = await uploadJobCuttingPlanExcelFile({
        companyId,
        jobId,
        file,
        extension,
      });
      await persistDoc(uploaded, file, extension);
      if (previousPath && previousPath !== uploaded.storagePath) {
        await removeOldStorage(previousPath);
      }
      toast({
        title: planDoc ? "Excel nahrazen" : "Excel nahrán",
        description: "Nářezový plánek je uložen u zakázky. Vzorce zůstávají v souboru.",
      });
      setPreviewOpen(true);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Nahrání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!canManage || !planDoc) return;
    if (!window.confirm("Smazat nářezový plánek (Excel) u této zakázky?")) return;
    setDeleting(true);
    try {
      await removeOldStorage(planDoc.storagePath);
      await deleteDoc(docRef);
      setPreviewData(null);
      toast({ title: "Excel smazán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = () => {
    if (!planDoc?.fileUrl) return;
    const a = document.createElement("a");
    a.href = planDoc.fileUrl;
    a.download = planDoc.fileName;
    a.rel = "noopener noreferrer";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExportPreviewPdf = () => {
    if (!previewData?.sheets.length || !planDoc) {
      toast({
        variant: "destructive",
        title: "Náhled není k dispozici",
        description: "Nejdříve načtěte tabulkový náhled.",
      });
      return;
    }
    const sheet = previewData.sheets[activeSheet] ?? previewData.sheets[0];
    const rows = sheet.rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "Prázdný list", description: "List neobsahuje data." });
      return;
    }
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    pdf.setFontSize(11);
    pdf.text(`Nářezový plánek — ${planDoc.fileName}`, 14, 12);
    pdf.setFontSize(9);
    pdf.text(`List: ${sheet.name}`, 14, 18);
    autoTable(pdf, {
      startY: 22,
      head: rows.length > 1 ? [rows[0].map((c) => String(c))] : undefined,
      body: (rows.length > 1 ? rows.slice(1) : rows).map((r) => r.map((c) => String(c))),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [234, 88, 12] },
      margin: { left: 10, right: 10 },
    });
    pdf.save(
      `${planDoc.fileName.replace(/\.[^.]+$/, "")}-nahled-${sheet.name.replace(/[^\w.-]+/g, "_")}.pdf`
    );
  };

  if (!canView) return null;

  const uploadedLabel = formatCuttingPlanUploadedAt(planDoc?.updatedAt ?? planDoc?.createdAt);

  return (
    <Card className={cn(JD.fullWidthCard)}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className={cn(JD.cardTitlePlain, "flex items-center gap-2")}>
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            Nářezový plánek / Excel
          </CardTitle>
          <p className="text-sm text-gray-600">
            Výpočtová tabulka pro nářez — soubor se ukládá k zakázce včetně vzorců. Náhled zobrazuje
            poslední uložené hodnoty z Excelu (bez přepočtu vzorců v prohlížeči).
          </p>
        </div>
        {canManage ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept={CUTTING_PLAN_EXCEL_ACCEPT}
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              className="gap-2"
              disabled={uploading || deleting}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {planDoc ? "Nahradit Excel" : "Nahrát Excel"}
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : !planDoc ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-8 text-center text-sm text-gray-700">
            {canManage
              ? "Zatím není nahrán žádný Excel. Použijte tlačítko „Nahrát Excel“ (.xlsx, .xls nebo .csv)."
              : "K této zakázce zatím není přiřazen nářezový plánek."}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1 break-words">
                <p className="font-semibold text-gray-950">{planDoc.fileName}</p>
                <p className="text-gray-600">
                  Nahráno: {uploadedLabel}
                  {planDoc.uploadedByName ? ` · ${planDoc.uploadedByName}` : ""}
                </p>
                {planDoc.fileSize > 0 ? (
                  <p className="text-xs text-gray-500">
                    {(planDoc.fileSize / 1024).toFixed(0)} KB · {planDoc.extension.toUpperCase()}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                  Stáhnout
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setPreviewOpen((v) => !v)}
                >
                  {previewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {previewOpen ? "Skrýt náhled" : "Otevřít náhled"}
                </Button>
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Nahradit
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      disabled={deleting || uploading}
                      onClick={() => void handleDelete()}
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Smazat
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {previewOpen ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">Tabulkový náhled</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {previewData?.truncated ? (
                      <Badge variant="secondary" className="font-normal">
                        Zobrazen výřez (max. {250} řádků × {40} sloupců)
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={previewLoading || !previewData}
                      onClick={handleExportPreviewPdf}
                    >
                      <FileDown className="h-4 w-4" />
                      Export náhledu PDF
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={previewLoading}
                      onClick={() => planDoc && void loadPreview(planDoc)}
                    >
                      Obnovit náhled
                    </Button>
                  </div>
                </div>

                {previewLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Načítám tabulku…
                  </div>
                ) : previewError ? (
                  <p className="text-sm text-destructive">{previewError}</p>
                ) : previewData && previewData.sheets.length > 0 ? (
                  <Tabs
                    value={String(activeSheet)}
                    onValueChange={(v) => setActiveSheet(Number(v))}
                  >
                    {previewData.sheets.length > 1 ? (
                      <TabsList className="mb-2 flex h-auto flex-wrap justify-start gap-1">
                        {previewData.sheets.map((s, i) => (
                          <TabsTrigger key={s.name} value={String(i)} className="text-xs sm:text-sm">
                            {s.name}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    ) : null}
                    {previewData.sheets.map((sheet, i) => (
                      <TabsContent key={sheet.name} value={String(i)} className="mt-0">
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                          <table className="min-w-full border-collapse text-left text-sm text-gray-900">
                            <tbody>
                              {sheet.rows.map((row, ri) => (
                                <tr
                                  key={`${sheet.name}-${ri}`}
                                  className={cn(
                                    ri === 0 && "bg-orange-50/90 font-semibold",
                                    ri % 2 === 1 && ri > 0 && "bg-gray-50/50"
                                  )}
                                >
                                  {row.map((cell, ci) => (
                                    <td
                                      key={`${ri}-${ci}`}
                                      className="whitespace-nowrap border border-gray-200 px-2.5 py-1.5 align-top tabular-nums"
                                    >
                                      {cell || "\u00a0"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                ) : (
                  <p className="text-sm text-muted-foreground">List je prázdný nebo nelze zobrazit.</p>
                )}
                <p className="text-xs text-gray-500">
                  Vzorce v souboru zůstávají zachované — po stažení a otevření v Excelu se přepočítají.
                  Náhled zobrazuje uložené hodnoty z posledního uložení v Excelu.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
