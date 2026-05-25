"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  doc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { deleteObject, getBytes, ref as storageRef } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { useDoc, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import { withTimeout } from "@/lib/async-with-timeout";
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
  CUTTING_PLAN_PREVIEW_EMPTY_MSG,
  CUTTING_PLAN_PREVIEW_LOAD_ERROR,
  CUTTING_PLAN_PREVIEW_MAX_COLS,
  CUTTING_PLAN_PREVIEW_MAX_ROWS,
  CUTTING_PLAN_PREVIEW_TIMEOUT_MS,
  parseCuttingPlanExcelBytes,
  parseCuttingPlanExcelFile,
  previewDataToSnapshot,
  snapshotToFirestoreFields,
  snapshotToPreviewData,
  type CuttingPlanPreviewData,
  type CuttingPlanPreviewSnapshot,
} from "@/lib/job-cutting-plan-excel-preview";
import {
  JobCuttingPlanExcelPreviewTable,
  type PreviewTableDraft,
} from "@/components/jobs/job-cutting-plan-excel-preview-table";
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
  Save,
  Undo2,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type PreviewUiStatus = "idle" | "loading" | "ready" | "error" | "empty";

type Props = {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  user: { uid: string; email?: string | null };
  authorName: string;
  canManage: boolean;
  canView: boolean;
};

function applyPreviewToUi(
  data: CuttingPlanPreviewData | null,
  setPreviewData: (d: CuttingPlanPreviewData | null) => void,
  setPreviewStatus: (s: PreviewUiStatus) => void,
  setPreviewError: (e: string | null) => void
) {
  if (!data) {
    setPreviewData(null);
    setPreviewStatus("idle");
    setPreviewError(null);
    return;
  }
  if (data.empty || data.sheets.length === 0) {
    setPreviewData(data);
    setPreviewStatus("empty");
    setPreviewError(null);
    return;
  }
  setPreviewData(data);
  setPreviewStatus("ready");
  setPreviewError(null);
}

export function JobCuttingPlanExcelSection(props: Props) {
  const { firestore, companyId, jobId, user, authorName, canManage, canView } = props;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateGenRef = useRef(0);

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
  const [savingEdits, setSavingEdits] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewStatus, setPreviewStatus] = useState<PreviewUiStatus>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<CuttingPlanPreviewData | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [draftComputed, setDraftComputed] = useState<Record<string, string>>({});
  const [revertSyncToken, setRevertSyncToken] = useState(0);
  const [dirty, setDirty] = useState(false);

  const previewTableSyncKey = useMemo(() => {
    const gen = planDoc?.preview?.generatedAt ?? 0;
    const updated =
      planDoc?.previewUpdatedAt != null
        ? String(planDoc.previewUpdatedAt)
        : "0";
    const path = planDoc?.storagePath ?? "";
    return `${gen}|${updated}|${path}|${revertSyncToken}`;
  }, [
    planDoc?.preview?.generatedAt,
    planDoc?.previewUpdatedAt,
    planDoc?.storagePath,
    revertSyncToken,
  ]);

  const canEditCells = canManage;

  const syncFromPlanDoc = useCallback((docMeta: JobCuttingPlanExcelDoc | null) => {
    if (!docMeta?.preview) {
      if (!docMeta) {
        setPreviewData(null);
        setPreviewStatus("idle");
        setDraftOverrides({});
        setDirty(false);
      } else {
        setPreviewStatus("idle");
      }
      setPreviewError(null);
      return;
    }
    const cached = snapshotToPreviewData(docMeta.preview);
    if (cached) {
      applyPreviewToUi(cached, setPreviewData, setPreviewStatus, setPreviewError);
      setDraftOverrides({ ...docMeta.preview.cellOverrides });
      setDraftComputed({ ...(docMeta.preview.computedValues ?? {}) });
      setDirty(false);
    }
  }, []);

  useEffect(() => {
    syncFromPlanDoc(planDoc);
  }, [
    planDoc?.preview?.generatedAt,
    planDoc?.storagePath,
    planDoc?.fileName,
    planDoc?.previewUpdatedAt,
    syncFromPlanDoc,
  ]);

  const savePreviewToFirestore = useCallback(
    async (snapshot: CuttingPlanPreviewSnapshot | null, clearOverrides = false) => {
      const fields = snapshotToFirestoreFields(snapshot);
      await setDoc(
        docRef,
        {
          ...fields,
          preview: deleteField(),
          ...(clearOverrides
            ? { cellOverrides: {}, previewUpdatedAt: serverTimestamp(), previewUpdatedBy: user.uid }
            : {}),
        },
        { merge: true }
      );
    },
    [docRef, user.uid]
  );

  const generatePreviewFromBytes = useCallback(
    async (bytes: ArrayBuffer, extension: JobCuttingPlanExcelDoc["extension"]) => {
      const gen = ++generateGenRef.current;
      setPreviewStatus("loading");
      setPreviewError(null);
      try {
        const parsed = await withTimeout(
          Promise.resolve().then(() => parseCuttingPlanExcelBytes(bytes, extension)),
          CUTTING_PLAN_PREVIEW_TIMEOUT_MS,
          "Generování náhledu"
        );
        if (gen !== generateGenRef.current) return null;
        const snapshot = previewDataToSnapshot(parsed);
        applyPreviewToUi(parsed, setPreviewData, setPreviewStatus, setPreviewError);
        if (snapshot) {
          await savePreviewToFirestore(snapshot, true);
          setDraftOverrides({});
          setDirty(false);
        }
        return parsed;
      } catch (e) {
        if (gen !== generateGenRef.current) return null;
        console.error("[CuttingPlanExcel] generate preview failed", e);
        setPreviewData(null);
        setPreviewStatus("error");
        setPreviewError(CUTTING_PLAN_PREVIEW_LOAD_ERROR);
        return null;
      }
    },
    [savePreviewToFirestore]
  );

  const generatePreviewFromStorage = useCallback(
    async (meta: JobCuttingPlanExcelDoc) => {
      const gen = ++generateGenRef.current;
      setPreviewStatus("loading");
      setPreviewError(null);
      try {
        const storage = getFirebaseStorage();
        const bytes = await withTimeout(
          getBytes(storageRef(storage, meta.storagePath)),
          CUTTING_PLAN_PREVIEW_TIMEOUT_MS,
          "Stažení souboru"
        );
        if (gen !== generateGenRef.current) return;
        await generatePreviewFromBytes(bytes, meta.extension);
      } catch (e) {
        if (gen !== generateGenRef.current) return;
        console.error("[CuttingPlanExcel] storage preview failed", e);
        setPreviewData(null);
        setPreviewStatus("error");
        setPreviewError(CUTTING_PLAN_PREVIEW_LOAD_ERROR);
      }
    },
    [generatePreviewFromBytes]
  );

  const persistDoc = async (
    upload: { fileUrl: string; storagePath: string; fileName: string },
    file: File,
    extension: NonNullable<ReturnType<typeof inferCuttingPlanExtension>>,
    preview: CuttingPlanPreviewSnapshot | null
  ) => {
    const previewFields = snapshotToFirestoreFields(preview);
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
        ...previewFields,
        preview: deleteField(),
        cellOverrides: preview?.cellOverrides ?? {},
        previewUpdatedAt: serverTimestamp(),
        previewUpdatedBy: user.uid,
        updatedAt: serverTimestamp(),
        ...(planDoc ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
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
      let previewSnapshot: CuttingPlanPreviewSnapshot | null = null;
      try {
        const parsed = await withTimeout(
          parseCuttingPlanExcelFile(file),
          CUTTING_PLAN_PREVIEW_TIMEOUT_MS,
          "Generování náhledu"
        );
        previewSnapshot = previewDataToSnapshot(parsed);
        applyPreviewToUi(parsed, setPreviewData, setPreviewStatus, setPreviewError);
        setDraftOverrides({});
        setDirty(false);
      } catch (previewErr) {
        console.warn("[CuttingPlanExcel] preview on upload failed", previewErr);
        setPreviewStatus("error");
        setPreviewError(CUTTING_PLAN_PREVIEW_LOAD_ERROR);
      }

      const uploaded = await uploadJobCuttingPlanExcelFile({
        companyId,
        jobId,
        file,
        extension,
      });
      await persistDoc(uploaded, file, extension, previewSnapshot);
      if (previousPath && previousPath !== uploaded.storagePath) {
        await deleteObject(storageRef(getFirebaseStorage(), previousPath));
      }
      toast({
        title: planDoc ? "Excel nahrazen" : "Excel nahrán",
        description: previewSnapshot
          ? "Soubor i tabulkový náhled jsou uloženy. Původní Excel ke stažení zůstává beze změny."
          : "Soubor je uložen. Náhled se nepodařilo vygenerovat — zkuste „Vygenerovat náhled“.",
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

  const handleSaveEdits = async () => {
    if (!canManage || !planDoc?.preview) return;
    setSavingEdits(true);
    try {
      await setDoc(
        docRef,
        {
          cellOverrides: draftOverrides,
          computedValues: draftComputed,
          previewUpdatedAt: serverTimestamp(),
          previewUpdatedBy: user.uid,
        },
        { merge: true }
      );
      setDirty(false);
      toast({ title: "Změny uloženy", description: "Úpravy v náhledu jsou uloženy u zakázky." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleRevertEdits = () => {
    if (planDoc?.preview) {
      setDraftOverrides({ ...planDoc.preview.cellOverrides });
      setDraftComputed({ ...(planDoc.preview.computedValues ?? {}) });
      setDirty(false);
      setRevertSyncToken((t) => t + 1);
      toast({ title: "Změny vráceny", description: "Obnoveny hodnoty z posledního uložení." });
    }
  };

  const handleDraftChange = (draft: PreviewTableDraft) => {
    setDraftOverrides(draft.overrides);
    setDraftComputed(draft.computedValues);
    const saved = planDoc?.preview?.cellOverrides ?? {};
    const changed = JSON.stringify(draft.overrides) !== JSON.stringify(saved);
    setDirty(changed);
  };

  const handleDelete = async () => {
    if (!canManage || !planDoc) return;
    if (!window.confirm("Smazat nářezový plánek (Excel) u této zakázky?")) return;
    setDeleting(true);
    generateGenRef.current++;
    try {
      await removeOldStorage(planDoc.storagePath);
      await deleteDoc(docRef);
      setPreviewData(null);
      setPreviewStatus("idle");
      setPreviewError(null);
      setDraftOverrides({});
      setDirty(false);
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

  const removeOldStorage = async (path: string | undefined) => {
    const p = path?.trim();
    if (!p) return;
    try {
      await deleteObject(storageRef(getFirebaseStorage(), p));
    } catch (e) {
      console.warn("[CuttingPlanExcel] old storage delete skipped", e);
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
    const sheet = previewData?.sheets[0];
    if (!sheet?.rows.length || !planDoc) {
      toast({
        variant: "destructive",
        title: "Náhled není k dispozici",
        description: "Nejdříve připravte tabulkový náhled.",
      });
      return;
    }
    const rows = sheet.rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "Prázdný list", description: CUTTING_PLAN_PREVIEW_EMPTY_MSG });
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

  const previewStatusLabel = (() => {
    switch (previewStatus) {
      case "loading":
        return "Načítám tabulku…";
      case "ready":
        return previewData?.truncated
          ? "Náhled připraven (zkrácená ukázka)"
          : "Náhled připraven";
      case "error":
        return "Náhled se nepodařilo načíst";
      case "empty":
        return CUTTING_PLAN_PREVIEW_EMPTY_MSG;
      default:
        return planDoc?.preview?.generatedAt
          ? "Náhled připraven"
          : "Náhled zatím není vygenerován";
    }
  })();

  if (!canView) return null;

  const uploadedLabel = formatCuttingPlanUploadedAt(planDoc?.updatedAt ?? planDoc?.createdAt);
  const sheet = previewData?.sheets[0];
  const formulaCells = previewData?.formulaCells ?? planDoc?.preview?.formulaCells ?? {};
  const baseRows = sheet?.rows ?? planDoc?.preview?.rows ?? [];
  const savedCellOverrides = planDoc?.preview?.cellOverrides ?? {};

  return (
    <Card className={cn(JD.fullWidthCard)}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className={cn(JD.cardTitlePlain, "flex items-center gap-2")}>
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            Nářezový plánek / Excel
          </CardTitle>
          <p className="text-sm text-gray-600">
            Původní soubor se nemění — úpravy v náhledu se ukládají zvlášť. Vzorce se přepočítají v
            tabulce (SUM, +, −, ×, ÷). Max. {CUTTING_PLAN_PREVIEW_MAX_ROWS} řádků ×{" "}
            {CUTTING_PLAN_PREVIEW_MAX_COLS} sloupců, výška náhledu je omezená.
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
          <p className="text-sm text-muted-foreground">Načítám metadata…</p>
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
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">Tabulkový náhled</p>
                    <p
                      className={cn(
                        "text-xs",
                        previewStatus === "error" ? "text-destructive" : "text-gray-600"
                      )}
                    >
                      {previewStatus === "error" && previewError
                        ? previewError
                        : previewStatusLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {previewStatus === "ready" && previewData?.truncated ? (
                      <Badge variant="secondary" className="font-normal">
                        Excel je moc velký — zobrazena zkrácená ukázka
                      </Badge>
                    ) : null}
                    {canEditCells && previewStatus === "ready" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5"
                          disabled={!dirty || savingEdits}
                          onClick={() => void handleSaveEdits()}
                        >
                          {savingEdits ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Uložit změny
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={!dirty || savingEdits}
                          onClick={handleRevertEdits}
                        >
                          <Undo2 className="h-4 w-4" />
                          Vrátit změny
                        </Button>
                      </>
                    ) : null}
                    {previewStatus === "ready" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleExportPreviewPdf}
                      >
                        <FileDown className="h-4 w-4" />
                        PDF
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={previewStatus === "loading"}
                      onClick={() => {
                        if (planDoc.preview && previewStatus !== "error" && !dirty) {
                          syncFromPlanDoc(planDoc);
                          return;
                        }
                        void generatePreviewFromStorage(planDoc);
                      }}
                    >
                      {previewStatus === "loading" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Obnovit náhled
                    </Button>
                    {previewStatus === "idle" && canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void generatePreviewFromStorage(planDoc)}
                      >
                        Vygenerovat náhled
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-6 rounded border border-amber-300 bg-amber-50" />
                    Upravitelná buňka
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-6 rounded border border-sky-300 bg-sky-50" />
                    Vzorec (přepočet v náhledu)
                  </span>
                </div>

                {previewStatus === "loading" ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Načítám tabulku… (max. {Math.round(CUTTING_PLAN_PREVIEW_TIMEOUT_MS / 1000)} s)
                  </div>
                ) : previewStatus === "ready" && baseRows.length > 0 ? (
                  <JobCuttingPlanExcelPreviewTable
                    sheetName={sheet?.name ?? planDoc.preview?.sheetName ?? "List1"}
                    rows={baseRows}
                    formulaCells={formulaCells}
                    cellOverrides={savedCellOverrides}
                    syncKey={previewTableSyncKey}
                    canEdit={canEditCells}
                    onDraftChange={canEditCells ? handleDraftChange : undefined}
                  />
                ) : previewStatus === "empty" ? (
                  <p className="text-sm text-muted-foreground py-2">{CUTTING_PLAN_PREVIEW_EMPTY_MSG}</p>
                ) : previewStatus === "idle" ? (
                  <p className="text-sm text-muted-foreground py-2">
                    {canManage
                      ? "Klikněte na „Vygenerovat náhled“ — data se uloží k zakázce bez vnořených polí ve Firestore."
                      : "Náhled tabulky zatím není k dispozici."}
                  </p>
                ) : null}

                <p className="text-xs text-gray-500">
                  Stažený Excel obsahuje původní vzorce. Úpravy z náhledu jsou v poli cellOverrides a
                  neupravují soubor ve Storage.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
