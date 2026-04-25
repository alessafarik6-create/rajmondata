"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  EMPLOYEE_DOC_TYPE_LABEL,
  isEmployeeDocContractLike,
  type EmployeeDocumentDoc,
  type EmployeeDocumentStatus,
  type EmployeeDocumentType,
} from "@/lib/employee-documents-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Upload, FileText, Download, Pencil, Trash2, PenLine } from "lucide-react";
import { EmployeeSignDocumentDialog } from "@/components/portal/EmployeeSignDocumentDialog";

type SectionMode = "all" | "contracts" | "photos" | "signatures";

const MAX_TITLE_LEN = 200;
const MAX_NOTE_LEN = 4000;
const ACCEPTED_EXT = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "doc",
  "docx",
] as const;

function extLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function defaultTypeForMode(mode: SectionMode): EmployeeDocumentType {
  if (mode === "contracts") return "employment_contract";
  if (mode === "photos") return "photo";
  return "other";
}

function statusBadge(s: EmployeeDocumentStatus) {
  if (s === "signed_both") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        Podepsáno oběma
      </Badge>
    );
  }
  if (s === "waiting_employee_signature") {
    return <Badge variant="secondary">Čeká na podpis zaměstnance</Badge>;
  }
  if (s === "waiting_company_signature") {
    return <Badge variant="secondary">Čeká na podpis firmy</Badge>;
  }
  return <Badge variant="outline">Draft</Badge>;
}

export function EmployeeDocumentsSection(props: {
  companyId: string;
  employeeId: string;
  /** admin / privileged */
  canManage: boolean;
  /** filtr dle tabů */
  mode?: SectionMode;
  title?: string;
}) {
  const { companyId, employeeId, canManage, mode = "all", title } = props;
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const docsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return collection(firestore, "companies", companyId, "employees", employeeId, "documents");
  }, [firestore, companyId, employeeId]);

  const { data: docsRaw = [], isLoading, error } = useCollection(docsQuery, {
    suppressGlobalPermissionError: true as const,
  });

  const docs = useMemo((): EmployeeDocumentDoc[] => {
    const raw = Array.isArray(docsRaw) ? docsRaw : [];
    return raw
      .map((d: any) => ({
        id: String(d?.id ?? ""),
        companyId: String(d?.companyId ?? ""),
        employeeId: String(d?.employeeId ?? ""),
        title: String(d?.title ?? ""),
        type: String(d?.type ?? "other") as EmployeeDocumentType,
        fileUrl: String(d?.fileUrl ?? ""),
        storagePath: String(d?.storagePath ?? ""),
        contentType: d?.contentType != null ? String(d.contentType) : undefined,
        note: d?.note != null ? String(d.note) : undefined,
        status: (String(d?.status ?? "draft") as EmployeeDocumentStatus) ?? "draft",
        createdAt: d?.createdAt,
        createdBy: d?.createdBy != null ? String(d.createdBy) : undefined,
        updatedAt: d?.updatedAt,
        updatedBy: d?.updatedBy != null ? String(d.updatedBy) : undefined,
        employeeSignedAt: d?.employeeSignedAt,
        employeeSignedBy: d?.employeeSignedBy != null ? String(d.employeeSignedBy) : undefined,
        employeeSignatureUrl:
          d?.employeeSignatureUrl != null ? String(d.employeeSignatureUrl) : undefined,
        companySignedAt: d?.companySignedAt,
        companySignedBy: d?.companySignedBy != null ? String(d.companySignedBy) : undefined,
        companySignatureUrl:
          d?.companySignatureUrl != null ? String(d.companySignatureUrl) : undefined,
        finalSignedPdfUrl:
          d?.finalSignedPdfUrl != null ? String(d.finalSignedPdfUrl) : undefined,
        finalSignedStoragePath:
          d?.finalSignedStoragePath != null ? String(d.finalSignedStoragePath) : undefined,
      }))
      .filter((d) => d.id && d.companyId && d.employeeId)
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [docsRaw]);

  const filtered = useMemo(() => {
    if (mode === "all") return docs;
    if (mode === "photos") return docs.filter((d) => d.type === "photo");
    if (mode === "contracts")
      return docs.filter((d) => isEmployeeDocContractLike(d.type));
    if (mode === "signatures")
      return docs.filter((d) => d.status !== "draft" || Boolean(d.finalSignedPdfUrl));
    return docs;
  }, [docs, mode]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadType, setUploadType] = useState<EmployeeDocumentType>(() =>
    defaultTypeForMode(mode)
  );
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const openUpload = () => {
    setUploadTitle("");
    setUploadType(defaultTypeForMode(mode));
    setUploadNote("");
    setUploadFile(null);
    setUploadOpen(true);
  };

  const canUpload = Boolean(canManage && user && firestore);

  const onUpload = async () => {
    if (!canUpload || !user || !firestore) return;
    if (!uploadFile) {
      toast({ variant: "destructive", title: "Vyberte soubor" });
      return;
    }
    const e = extLower(uploadFile.name);
    if (!ACCEPTED_EXT.includes(e as any)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný typ souboru",
        description: `Povoleno: ${ACCEPTED_EXT.join(", ")}`,
      });
      return;
    }
    const t = uploadTitle.trim().slice(0, MAX_TITLE_LEN);
    const titleFinal = t || uploadFile.name.slice(0, MAX_TITLE_LEN);
    const noteFinal = uploadNote.trim().slice(0, MAX_NOTE_LEN);

    setUploadBusy(true);
    try {
      const docsCol = collection(
        firestore,
        "companies",
        companyId,
        "employees",
        employeeId,
        "documents"
      );
      const newRef = doc(docsCol);
      const documentId = newRef.id;

      const storagePath = `companies/${companyId}/employees/${employeeId}/documents/${documentId}/${uploadFile.name}`;
      const sref = storageRef(getFirebaseStorage(), storagePath);
      await uploadBytes(sref, uploadFile, {
        contentType: uploadFile.type || "application/octet-stream",
      });
      const fileUrl = await getDownloadURL(sref);

      const status: EmployeeDocumentStatus = "draft";
      await setDoc(
        newRef,
        {
          id: documentId,
          companyId,
          employeeId,
          title: titleFinal,
          type: uploadType,
          fileUrl,
          storagePath,
          contentType: uploadFile.type || "application/octet-stream",
          note: noteFinal,
          status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
          updatedBy: user.uid,
        },
        { merge: true }
      );

      toast({ title: "Dokument nahrán" });
      setUploadOpen(false);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Upload selhal",
        description: err instanceof Error ? err.message : "Zkuste to znovu.",
      });
    } finally {
      setUploadBusy(false);
    }
  };

  const [editDoc, setEditDoc] = useState<EmployeeDocumentDoc | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const openEdit = (d: EmployeeDocumentDoc) => {
    setEditDoc(d);
    setEditTitle(d.title || "");
    setEditNote(d.note || "");
  };

  const saveEdit = async () => {
    if (!canManage || !user || !firestore || !editDoc?.id) return;
    const nextTitle = editTitle.trim().slice(0, MAX_TITLE_LEN);
    if (!nextTitle) {
      toast({ variant: "destructive", title: "Chybí název dokumentu" });
      return;
    }
    const nextNote = editNote.trim().slice(0, MAX_NOTE_LEN);
    setEditBusy(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "employees",
          employeeId,
          "documents",
          editDoc.id
        ),
        {
          title: nextTitle,
          note: nextNote,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        } as DocumentData
      );
      toast({ title: "Uloženo" });
      setEditDoc(null);
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Uložení selhalo" });
    } finally {
      setEditBusy(false);
    }
  };

  const [deleteDocRow, setDeleteDocRow] = useState<EmployeeDocumentDoc | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signAs, setSignAs] = useState<"employee" | "company">("employee");
  const [signDoc, setSignDoc] = useState<EmployeeDocumentDoc | null>(null);

  const doDelete = async () => {
    if (!canManage || !user || !firestore || !deleteDocRow?.id) return;
    setDeleteBusy(true);
    try {
      const paths = [
        deleteDocRow.storagePath,
        deleteDocRow.finalSignedStoragePath ?? "",
      ].filter((p) => p && String(p).trim());
      for (const p of paths) {
        try {
          await deleteObject(storageRef(getFirebaseStorage(), p));
        } catch {
          /* ignore */
        }
      }
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "employees",
          employeeId,
          "documents",
          deleteDocRow.id
        )
      );
      toast({ title: "Dokument smazán" });
      setDeleteDocRow(null);
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Smazání selhalo" });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-lg text-black">
            {title || "Dokumenty zaměstnance"}
          </CardTitle>
          <p className="mt-1 text-sm text-slate-700">
            PDF, obrázky a kancelářské dokumenty. Smazání a úpravy provádí pouze
            administrátor.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            className="h-10"
            disabled={!canUpload}
            onClick={openUpload}
          >
            <Upload className="mr-2 h-4 w-4" />
            Nahrát
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="default" className="border-amber-300 bg-amber-50">
            <AlertTitle>Dokumenty se nepodařilo načíst</AlertTitle>
            <AlertDescription>
              Zkontrolujte přístupová práva nebo obnovte stránku.
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            Načítání…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-700">Zatím žádné dokumenty.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-black">Název</TableHead>
                  <TableHead className="text-black">Typ</TableHead>
                  <TableHead className="text-black">Stav</TableHead>
                  <TableHead className="text-black">Poznámka</TableHead>
                  <TableHead className="text-right text-black">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="min-w-[220px] font-medium text-black">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-500" />
                        <span className="break-words">{d.title || d.id}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-black">
                      {EMPLOYEE_DOC_TYPE_LABEL[d.type] ?? d.type}
                    </TableCell>
                    <TableCell>{statusBadge(d.status)}</TableCell>
                    <TableCell className="max-w-[320px] text-xs text-slate-700">
                      {d.note?.trim() ? d.note.trim() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label="Stáhnout"
                          onClick={() => window.open(d.finalSignedPdfUrl || d.fileUrl, "_blank")}
                          disabled={!d.fileUrl}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label="Podepsat"
                          disabled={!canManage || d.contentType !== "application/pdf"}
                          onClick={() => {
                            setSignDoc(d);
                            setSignAs("employee");
                            setSignOpen(true);
                          }}
                          title="Podepsat elektronicky (za zaměstnance)"
                        >
                          <PenLine className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label="Podepsat za firmu"
                          disabled={!canManage || d.contentType !== "application/pdf"}
                          onClick={() => {
                            setSignDoc(d);
                            setSignAs("company");
                            setSignOpen(true);
                          }}
                          title="Podepsat elektronicky (za firmu)"
                        >
                          <PenLine className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label="Upravit"
                          disabled={!canManage}
                          onClick={() => openEdit(d)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className={cn("h-9 w-9", canManage ? "text-destructive" : "opacity-40")}
                          aria-label="Smazat"
                          disabled={!canManage}
                          onClick={() => setDeleteDocRow(d)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nahrát dokument</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label className="text-black">Soubor</Label>
              <Input
                type="file"
                accept={ACCEPTED_EXT.map((e) => `.${e}`).join(",")}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                disabled={!canUpload || uploadBusy}
              />
              <p className="text-xs text-slate-600">
                Podporované: PDF, JPG/PNG/WebP, DOC/DOCX.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-black">Název dokumentu</Label>
              <Input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                maxLength={MAX_TITLE_LEN}
                placeholder="např. Pracovní smlouva 2026"
                disabled={!canUpload || uploadBusy}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Typ</Label>
              <select
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={uploadType}
                disabled={!canUpload || uploadBusy}
                onChange={(e) => setUploadType(e.target.value as EmployeeDocumentType)}
              >
                {(
                  [
                    "employment_contract",
                    "dpp",
                    "dpc",
                    "agreement_other",
                    "addendum",
                    "personal_id",
                    "photo",
                    "other",
                  ] as EmployeeDocumentType[]
                ).map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYEE_DOC_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-black">Poznámka</Label>
              <Textarea
                value={uploadNote}
                onChange={(e) => setUploadNote(e.target.value)}
                rows={3}
                maxLength={MAX_NOTE_LEN}
                disabled={!canUpload || uploadBusy}
              />
            </div>
          </div>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setUploadOpen(false)}
              disabled={uploadBusy}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={!canUpload || uploadBusy}
              onClick={() => void onUpload()}
            >
              {uploadBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Nahrát"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDoc != null} onOpenChange={(o) => !o && setEditDoc(null)}>
        <DialogContent className="border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upravit dokument</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label className="text-black">Název</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={MAX_TITLE_LEN}
                disabled={!canManage || editBusy}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Poznámka</Label>
              <Textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                maxLength={MAX_NOTE_LEN}
                rows={3}
                disabled={!canManage || editBusy}
              />
            </div>
          </div>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setEditDoc(null)}
              disabled={editBusy}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={!canManage || editBusy}
              onClick={() => void saveEdit()}
            >
              {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDocRow != null}
        onOpenChange={(o) => !o && setDeleteDocRow(null)}
      >
        <DialogContent className="border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Smazat dokument?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-700">
            {deleteDocRow
              ? `Opravdu smazat „${deleteDocRow.title || deleteDocRow.id}“? Tato akce je nevratná.`
              : ""}
          </p>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setDeleteDocRow(null)}
              disabled={deleteBusy}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={!canManage || deleteBusy}
              onClick={() => void doDelete()}
            >
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Smazat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {signDoc ? (
        <EmployeeSignDocumentDialog
          open={signOpen}
          onOpenChange={(o) => {
            setSignOpen(o);
            if (!o) setSignDoc(null);
          }}
          companyId={companyId}
          employeeId={employeeId}
          docRow={signDoc}
          signAs={signAs}
        />
      ) : null}
    </Card>
  );
}

