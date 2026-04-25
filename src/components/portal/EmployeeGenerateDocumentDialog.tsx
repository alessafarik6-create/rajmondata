"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { jsPDF } from "jspdf";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  type EmployeeDocumentTemplateDoc,
  type EmployeeDocumentTemplateType,
} from "@/lib/employee-documents-schema";
import { registerDejaVuFontsForPdf, PDF_FONT_FAMILY } from "@/lib/pdf/register-dejavu-font";
import { applyContractTemplatePlaceholders } from "@/lib/contract-template-placeholders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FilePlus2 } from "lucide-react";

const TEMPLATE_TYPE_LABEL: Record<EmployeeDocumentTemplateType, string> = {
  employment_contract: "Pracovní smlouva",
  dpp: "DPP",
  dpc: "DPČ",
  agreement_other: "Dohoda / jiný dokument",
};

function wrapTextLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (const para of raw.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    const lines = doc.splitTextToSize(para, maxWidth) as string[];
    for (const l of lines) out.push(String(l));
  }
  return out;
}

export function EmployeeGenerateDocumentDialog(props: {
  companyId: string;
  employeeId: string;
  canManage: boolean;
  company: Record<string, unknown> | null | undefined;
  employee: Record<string, unknown> | null | undefined;
}) {
  const { companyId, employeeId, canManage, company, employee } = props;
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const templatesRef = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employeeDocumentTemplates");
  }, [firestore, companyId]);
  const { data: rawTemplates = [], isLoading: templatesLoading } = useCollection(
    templatesRef,
    { suppressGlobalPermissionError: true as const }
  );

  const templates = useMemo((): EmployeeDocumentTemplateDoc[] => {
    const rows = Array.isArray(rawTemplates) ? rawTemplates : [];
    return rows
      .map((t: any) => ({
        id: String(t?.id ?? ""),
        companyId: String(t?.companyId ?? ""),
        title: String(t?.title ?? ""),
        type: String(t?.type ?? "agreement_other") as EmployeeDocumentTemplateType,
        content: String(t?.content ?? ""),
      }))
      .filter((t) => t.id && t.title && t.content);
  }, [rawTemplates]);

  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  const defaultEmployeeName = useMemo(() => {
    const first = String(employee?.firstName ?? "").trim();
    const last = String(employee?.lastName ?? "").trim();
    return [first, last].filter(Boolean).join(" ").trim();
  }, [employee]);

  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePhone, setEmployeePhone] = useState("");
  const [employeeAddress, setEmployeeAddress] = useState("");
  const [employeePosition, setEmployeePosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [salary, setSalary] = useState("");
  const [companyRepresentative, setCompanyRepresentative] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");

  const todayDate = useMemo(
    () => new Date().toLocaleDateString("cs-CZ"),
    []
  );

  const resetFieldsFromDocs = () => {
    setEmployeeName(defaultEmployeeName);
    setEmployeeEmail(String(employee?.email ?? "").trim());
    setEmployeePhone(String(employee?.phone ?? employee?.phoneNumber ?? "").trim());
    setEmployeeAddress(String(employee?.address ?? "").trim());
    setEmployeePosition(String(employee?.jobTitle ?? employee?.position ?? "").trim());
    setHourlyRate(
      employee?.hourlyRate != null && employee?.hourlyRate !== ""
        ? String(employee.hourlyRate)
        : ""
    );
    setSalary(employee?.salary != null && employee?.salary !== "" ? String(employee.salary) : "");
    setCompanyRepresentative(String((company as any)?.companyRepresentative ?? "").trim());
    setContractStartDate("");
  };

  const previewText = useMemo(() => {
    if (!selectedTemplate) return "";
    const values: Record<string, string | undefined> = {
      employeeName: employeeName || defaultEmployeeName,
      employeeEmail,
      employeePhone,
      employeeAddress,
      employeePosition,
      hourlyRate,
      salary,
      companyName: String((company as any)?.companyName ?? (company as any)?.name ?? "").trim(),
      companyICO: String((company as any)?.ico ?? "").trim(),
      companyAddress: String((company as any)?.address ?? "").trim(),
      companyRepresentative,
      todayDate,
      contractStartDate,
    };
    return applyContractTemplatePlaceholders(selectedTemplate.content, values);
  }, [
    selectedTemplate,
    employeeName,
    defaultEmployeeName,
    employeeEmail,
    employeePhone,
    employeeAddress,
    employeePosition,
    hourlyRate,
    salary,
    company,
    companyRepresentative,
    todayDate,
    contractStartDate,
  ]);

  const [busy, setBusy] = useState(false);

  const generateAndSave = async () => {
    if (!canManage || !user || !firestore || !selectedTemplate) return;
    setBusy(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      await registerDejaVuFontsForPdf(pdf, "/fonts");
      pdf.setFont(PDF_FONT_FAMILY, "normal");
      pdf.setFontSize(12);

      const marginX = 16;
      const marginY = 18;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const maxW = pageW - marginX * 2;
      const lineH = 6;

      const lines = wrapTextLines(pdf, previewText, maxW);
      let y = marginY;
      for (const line of lines) {
        if (y + lineH > pageH - marginY) {
          pdf.addPage();
          pdf.setFont(PDF_FONT_FAMILY, "normal");
          pdf.setFontSize(12);
          y = marginY;
        }
        if (line === "") {
          y += lineH;
          continue;
        }
        pdf.text(line, marginX, y);
        y += lineH;
      }

      const blob = pdf.output("blob") as Blob;

      const docsCol = collection(
        firestore,
        "companies",
        companyId,
        "employees",
        employeeId,
        "documents"
      );
      const docRef = doc(docsCol);
      const documentId = docRef.id;
      const safeTitle = (selectedTemplate.title || "dokument")
        .replace(/[^\w\u00C0-\u024f\s-]+/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 60);
      const fileName = `${safeTitle || "dokument"}_${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;

      const storagePath = `companies/${companyId}/employees/${employeeId}/documents/${documentId}/${fileName}`;
      const sref = storageRef(getFirebaseStorage(), storagePath);
      await uploadBytes(sref, blob, { contentType: "application/pdf" });
      const fileUrl = await getDownloadURL(sref);

      await setDoc(
        docRef,
        {
          id: documentId,
          companyId,
          employeeId,
          title: selectedTemplate.title,
          type: selectedTemplate.type,
          fileUrl,
          storagePath,
          contentType: "application/pdf",
          note: "",
          status: "waiting_employee_signature",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
          updatedBy: user.uid,
        },
        { merge: true }
      );

      toast({ title: "PDF vygenerováno a uloženo" });
      setOpen(false);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Generování selhalo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        className="h-10"
        disabled={!canManage}
        onClick={() => {
          resetFieldsFromDocs();
          setSelectedTemplateId("");
          setOpen(true);
        }}
      >
        <FilePlus2 className="mr-2 h-4 w-4" />
        Vygenerovat dokument
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Vygenerovat dokument (PDF)</DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Šablona</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={templatesLoading || busy}
                >
                  <option value="">— vyberte šablonu —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({TEMPLATE_TYPE_LABEL[t.type] ?? t.type})
                    </option>
                  ))}
                </select>
                {templatesLoading ? (
                  <p className="text-xs text-slate-600">
                    Načítání šablon…
                  </p>
                ) : null}
              </div>

              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base">Doplňte údaje</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Jméno zaměstnance</Label>
                      <Input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input value={employeeEmail} onChange={(e) => setEmployeeEmail(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Telefon</Label>
                      <Input value={employeePhone} onChange={(e) => setEmployeePhone(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Pozice</Label>
                      <Input value={employeePosition} onChange={(e) => setEmployeePosition(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Hodinová sazba</Label>
                      <Input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="např. 250" />
                    </div>
                    <div className="space-y-2">
                      <Label>Mzda</Label>
                      <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="např. 38000" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Adresa zaměstnance</Label>
                    <Input value={employeeAddress} onChange={(e) => setEmployeeAddress(e.target.value)} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Zástupce firmy</Label>
                      <Input value={companyRepresentative} onChange={(e) => setCompanyRepresentative(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Datum nástupu / začátku</Label>
                      <Input type="date" value={contractStartDate} onChange={(e) => setContractStartDate(e.target.value)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-2">
              <Label>Náhled (po dosazení proměnných)</Label>
              <Textarea value={previewText} readOnly className="min-h-[520px] bg-slate-50" />
              <p className="text-xs text-slate-600">
                PDF se vygeneruje s fontem DejaVu Sans (diakritika, čeština) a uloží se do dokumentů zaměstnance.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
              Zrušit
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={!selectedTemplate || busy}
              onClick={() => void generateAndSave()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vygenerovat a uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

