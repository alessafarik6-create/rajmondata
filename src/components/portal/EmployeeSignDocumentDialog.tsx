"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, updateDoc, type DocumentData } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { jsPDF } from "jspdf";
import { useFirestore, useUser } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import type { EmployeeDocumentDoc } from "@/lib/employee-documents-schema";
import { registerDejaVuFontsForPdf, PDF_FONT_FAMILY } from "@/lib/pdf/register-dejavu-font";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pencil, Eraser } from "lucide-react";

type SignAs = "employee" | "company";

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",", 2);
  const m = /data:([^;]+);base64/.exec(meta || "");
  const contentType = m?.[1] || "image/png";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

async function renderPdfToJspdfImages(opts: {
  pdfUrl: string;
  signatureEmployeeDataUrl?: string | null;
  signatureCompanyDataUrl?: string | null;
  signatureMetaText?: string;
}): Promise<Blob> {
  const pdfjs = await import("pdfjs-dist");
  const ver = (pdfjs as any).version || "4.10.38";
  const major = Number(String(ver).split(".")[0] || "4");
  (pdfjs as any).GlobalWorkerOptions.workerSrc =
    major === 3
      ? "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      : `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;

  const task = (pdfjs as any).getDocument(opts.pdfUrl);
  const pdf = await task.promise;

  const out = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(out, "/fonts");
  out.setFont(PDF_FONT_FAMILY, "normal");

  const pageW = out.internal.pageSize.getWidth();
  const pageH = out.internal.pageSize.getHeight();

  // Render each PDF page into a canvas and add as full-page image.
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Nelze vykreslit PDF (canvas).");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const img = canvas.toDataURL("image/jpeg", 0.92);

    if (i > 1) out.addPage();
    out.addImage(img, "JPEG", 0, 0, pageW, pageH);
  }

  // Overlay signatures on last page (bottom area).
  const lastPage = pdf.numPages >= 1 ? pdf.numPages : 1;
  out.setPage(lastPage);
  const pad = 12;
  const boxH = 28;
  const boxW = (pageW - pad * 2 - 8) / 2;
  const y = pageH - pad - boxH;
  const x1 = pad;
  const x2 = pad + boxW + 8;

  out.setDrawColor(40);
  out.setFillColor(255, 255, 255);
  out.rect(x1, y, boxW, boxH, "S");
  out.rect(x2, y, boxW, boxH, "S");
  out.setFontSize(9);
  out.text("Podpis zaměstnance", x1 + 2, y + 6);
  out.text("Podpis firmy", x2 + 2, y + 6);

  if (opts.signatureEmployeeDataUrl) {
    out.addImage(opts.signatureEmployeeDataUrl, "PNG", x1 + 2, y + 8, boxW - 4, boxH - 12);
  }
  if (opts.signatureCompanyDataUrl) {
    out.addImage(opts.signatureCompanyDataUrl, "PNG", x2 + 2, y + 8, boxW - 4, boxH - 12);
  }

  if (opts.signatureMetaText) {
    out.setFontSize(7);
    out.text(opts.signatureMetaText, pad, pageH - 6);
  }

  return out.output("blob") as Blob;
}

export function EmployeeSignDocumentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  employeeId: string;
  docRow: EmployeeDocumentDoc;
  signAs: SignAs;
}) {
  const { open, onOpenChange, companyId, employeeId, docRow, signAs } = props;
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [signerName, setSignerName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSignerName(
      (user?.displayName && String(user.displayName).trim()) ||
        (user?.email && String(user.email).trim()) ||
        ""
    );
    const c = canvasRef.current;
    if (!c) return;
    // reset
    c.width = 900;
    c.height = 260;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [open, user?.displayName, user?.email]);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  const pointerPos = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * ev.currentTarget.width;
    const y = ((ev.clientY - rect.top) / rect.height) * ev.currentTarget.height;
    return { x, y };
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drawingRef.current = true;
    lastPt.current = pointerPos(ev);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = pointerPos(ev);
    const last = lastPt.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastPt.current = p;
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    lastPt.current = null;
  };

  const save = async () => {
    if (!user || !firestore) return;
    if (!docRow.fileUrl) {
      toast({ variant: "destructive", title: "Chybí PDF" });
      return;
    }
    const c = canvasRef.current;
    if (!c) return;

    setBusy(true);
    try {
      const signatureDataUrl = c.toDataURL("image/png");
      const sigBlob = dataUrlToBlob(signatureDataUrl);
      const role = signAs;
      const sigPath = `companies/${companyId}/employees/${employeeId}/documents/${docRow.id}/signatures/${role}.png`;
      const sigRef = storageRef(getFirebaseStorage(), sigPath);
      await uploadBytes(sigRef, sigBlob, { contentType: "image/png" });
      const sigUrl = await getDownloadURL(sigRef);

      const nowMeta = new Date().toLocaleString("cs-CZ");
      const signerLabel = signerName.trim().slice(0, 200) || user.uid;

      const docFsRef = doc(
        firestore,
        "companies",
        companyId,
        "employees",
        employeeId,
        "documents",
        docRow.id
      );

      const patch: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };

      if (role === "employee") {
        patch.employeeSignatureUrl = sigUrl;
        patch.employeeSignedAt = serverTimestamp();
        patch.employeeSignedBy = signerLabel;
      } else {
        patch.companySignatureUrl = sigUrl;
        patch.companySignedAt = serverTimestamp();
        patch.companySignedBy = signerLabel;
      }

      // status progression
      const nextStatus = (() => {
        const hasEmp = role === "employee" ? true : Boolean(docRow.employeeSignatureUrl);
        const hasComp = role === "company" ? true : Boolean(docRow.companySignatureUrl);
        if (hasEmp && hasComp) return "signed_both";
        if (hasEmp) return "waiting_company_signature";
        return "waiting_employee_signature";
      })();
      patch.status = nextStatus;

      await updateDoc(docFsRef, patch as DocumentData);

      // If both signatures are present after this signing, create final signed PDF.
      const bothNow =
        (role === "employee" ? true : Boolean(docRow.employeeSignatureUrl)) &&
        (role === "company" ? true : Boolean(docRow.companySignatureUrl));

      if (bothNow) {
        const finalBlob = await renderPdfToJspdfImages({
          pdfUrl: docRow.fileUrl,
          signatureEmployeeDataUrl:
            role === "employee" ? signatureDataUrl : null,
          signatureCompanyDataUrl:
            role === "company" ? signatureDataUrl : null,
          signatureMetaText: `Podepsáno elektronicky · ${nowMeta}`,
        });

        const finalPath = `companies/${companyId}/employees/${employeeId}/documents/${docRow.id}/final_signed.pdf`;
        const finalRef = storageRef(getFirebaseStorage(), finalPath);
        await uploadBytes(finalRef, finalBlob, { contentType: "application/pdf" });
        const finalUrl = await getDownloadURL(finalRef);

        await updateDoc(
          docFsRef,
          {
            finalSignedPdfUrl: finalUrl,
            finalSignedStoragePath: finalPath,
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
          } as DocumentData
        );
      }

      toast({ title: "Podpis uložen" });
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Podepsání selhalo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Podepsat elektronicky — {signAs === "employee" ? "za zaměstnance" : "za firmu"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Jméno podepisující osoby</Label>
            <Input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              disabled={busy}
              placeholder="např. Jan Novák"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Kreslený podpis</Label>
              <Button type="button" variant="outline" size="sm" onClick={clear} disabled={busy}>
                <Eraser className="mr-2 h-4 w-4" />
                Vymazat
              </Button>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-2">
              <canvas
                ref={canvasRef}
                className="h-[140px] w-full touch-none rounded bg-white"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <p className="text-xs text-slate-600">
              Podpis se uloží jako obrázek a zároveň se vytvoří finální podepsané PDF (rasterizované pro
              konzistentní zobrazení na mobilu i PC).
            </p>
          </div>
        </div>

        <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" className="h-11" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Podepsat a uložit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

