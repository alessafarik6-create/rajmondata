"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { DocumentEmailRecipientPicker } from "@/components/documents/document-email-recipient-picker";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import { buildQuickMaterialOrderPdfHtml } from "@/lib/quick-material-order-pdf-html";
import { sendJobDocumentEmailFromBrowser } from "@/lib/document-email-send-client";
import {
  hasNonEmptyTextSubjectAndBody,
  isValidEmailAddress,
  normalizeEmailBodyToHtml,
} from "@/lib/document-email-outbound";
import { Loader2, Mail, ExternalLink, Download, Package } from "lucide-react";

export type ProductionSheetStatus = "ready" | "inProduction" | "done";

export type QuickMaterialOrderStatus = "draft" | "sent" | "ordered" | "received" | "canceled";

const SHEET_STATUS_LABEL: Record<ProductionSheetStatus, string> = {
  ready: "Připraveno",
  inProduction: "Vyrábím",
  done: "Hotovo",
};

const QUICK_STATUS_LABEL: Record<Exclude<QuickMaterialOrderStatus, "draft">, string> = {
  sent: "Odesláno",
  ordered: "Objednáno",
  received: "Přijato",
  canceled: "Zrušeno",
};

function formatTs(raw: unknown): string {
  if (raw == null) return "—";
  try {
    const d =
      typeof (raw as { toDate?: () => Date }).toDate === "function"
        ? (raw as { toDate: () => Date }).toDate()
        : raw instanceof Date
          ? raw
          : new Date(String(raw));
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("cs-CZ");
  } catch {
    return "—";
  }
}

function dateIsoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

type ProductionSheetRow = {
  id: string;
  fileName?: string;
  fileUrl?: string;
  status?: ProductionSheetStatus;
  createdAt?: unknown;
  createdByName?: string;
  productionStartedAt?: unknown;
  productionStartedByName?: string;
};

type QuickOrderRow = {
  id: string;
  title?: string;
  documentNumber?: string;
  recipientEmail?: string;
  quickOrderStatus?: QuickMaterialOrderStatus;
  sentAt?: unknown;
  sentByName?: string;
  fileUrl?: string;
  lastEmailSentTo?: string;
};

export function ProductionJobTopExtras(props: {
  companyId: string;
  jobId: string;
  companyDisplayName: string;
  jobLabel: string;
  customerLabel: string;
  userId: string;
  actorDisplayName: string;
  suggestionEmails?: Array<{ email: string; label: string }>;
  canMutate: boolean;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTo, setQuickTo] = useState("");
  const [quickCc, setQuickCc] = useState("");
  const [quickSubject, setQuickSubject] = useState("");
  const [quickBody, setQuickBody] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickCtx, setQuickCtx] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [includeJobCtx, setIncludeJobCtx] = useState(true);

  const sheetsQ = useMemoFirebase(() => {
    if (!firestore || !props.companyId || !props.jobId) return null;
    return query(
      collection(firestore, "companies", props.companyId, "jobs", props.jobId, "productionSheets"),
      orderBy("createdAt", "desc")
    );
  }, [firestore, props.companyId, props.jobId]);

  const ordersQ = useMemoFirebase(() => {
    if (!firestore || !props.companyId || !props.jobId) return null;
    return query(
      collection(firestore, "companies", props.companyId, "jobs", props.jobId, "materialOrders"),
      orderBy("createdAt", "desc")
    );
  }, [firestore, props.companyId, props.jobId]);

  const { data: sheetsRaw } = useCollection(sheetsQ);
  const { data: ordersRaw } = useCollection(ordersQ);

  const sheets = useMemo(() => {
    const rows = Array.isArray(sheetsRaw) ? sheetsRaw : [];
    return rows.map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: String((r as { id?: string }).id ?? ""),
        fileName: String(x.fileName ?? "PDF"),
        fileUrl: String(x.fileUrl ?? ""),
        status: (String(x.status ?? "ready") as ProductionSheetStatus) || "ready",
        createdAt: x.createdAt,
        createdByName: String(x.createdByName ?? "").trim() || "—",
        productionStartedAt: x.productionStartedAt,
        productionStartedByName: String(x.productionStartedByName ?? "").trim(),
      };
    }) as ProductionSheetRow[];
  }, [sheetsRaw]);

  const quickOrders = useMemo(() => {
    const rows = Array.isArray(ordersRaw) ? ordersRaw : [];
    return rows
      .filter((r) => String((r as Record<string, unknown>).orderKind ?? "") === "quick_text")
      .map((r) => {
        const x = r as Record<string, unknown>;
        const st = String(x.quickOrderStatus ?? "draft") as QuickMaterialOrderStatus;
        return {
          id: String((r as { id?: string }).id ?? ""),
          title: String(x.title ?? x.subject ?? "Objednávka").trim() || "Objednávka",
          documentNumber: String(x.documentNumber ?? "").trim(),
          recipientEmail: String(x.recipientEmail ?? x.lastEmailSentTo ?? "").trim(),
          quickOrderStatus: st,
          sentAt: x.sentAt ?? x.lastEmailSentAt,
          sentByName: String(x.sentByName ?? "").trim(),
          fileUrl: String(x.fileUrl ?? "").trim(),
          lastEmailSentTo: String(x.lastEmailSentTo ?? "").trim(),
        };
      }) as QuickOrderRow[];
  }, [ordersRaw]);

  const setSheetProduction = useCallback(
    async (row: ProductionSheetRow) => {
      if (!firestore || !props.canMutate) return;
      try {
        await updateDoc(
          doc(firestore, "companies", props.companyId, "jobs", props.jobId, "productionSheets", row.id),
          {
            status: "inProduction",
            productionStartedAt: serverTimestamp(),
            productionStartedBy: props.userId,
            productionStartedByName: props.actorDisplayName || null,
          }
        );
        toast({ title: "Stav uložen", description: "Výrobní podklad je ve stavu „Vyrábím“." });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [firestore, props.actorDisplayName, props.canMutate, props.companyId, props.jobId, props.userId, toast]
  );

  const setSheetDone = useCallback(
    async (row: ProductionSheetRow) => {
      if (!firestore || !props.canMutate) return;
      try {
        await updateDoc(
          doc(firestore, "companies", props.companyId, "jobs", props.jobId, "productionSheets", row.id),
          { status: "done" }
        );
        toast({ title: "Hotovo", description: "Stav výrobního podkladu byl nastaven na „Hotovo“." });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [firestore, props.canMutate, props.companyId, props.jobId, toast]
  );

  const setOrderOrdered = useCallback(
    async (row: QuickOrderRow) => {
      if (!firestore || !props.canMutate) return;
      try {
        await updateDoc(
          doc(firestore, "companies", props.companyId, "jobs", props.jobId, "materialOrders", row.id),
          {
            quickOrderStatus: "ordered",
            orderedAt: serverTimestamp(),
            orderedBy: props.userId,
            orderedByName: props.actorDisplayName || null,
          }
        );
        toast({ title: "Stav uložen", description: "Objednávka je ve stavu „Objednáno“." });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [firestore, props.actorDisplayName, props.canMutate, props.companyId, props.jobId, props.userId, toast]
  );

  const openQuick = useCallback(() => {
    setQuickTo("");
    setQuickCc("");
    setQuickSubject(`Objednávka materiálu — ${props.jobLabel}`);
    setQuickBody("");
    setQuickNote("");
    setQuickCtx("");
    setIncludeJobCtx(true);
    setQuickOpen(true);
  }, [props.jobLabel]);

  const submitQuickOrder = useCallback(async () => {
    if (!firestore) return;
    if (!hasNonEmptyTextSubjectAndBody({ subject: quickSubject, bodyPlain: quickBody })) {
      toast({
        variant: "destructive",
        title: "Vyplňte údaje",
        description: "Předmět a text objednávky jsou povinné.",
      });
      return;
    }
    if (!isValidEmailAddress(quickTo.trim())) {
      toast({ variant: "destructive", title: "Neplatný e-mail", description: "Zkontrolujte adresu příjemce." });
      return;
    }
    setQuickSaving(true);
    try {
      const docNo = await allocateNextDocumentNumber(firestore, props.companyId, "OBJ");
      const ctxLine =
        includeJobCtx
          ? [props.jobLabel, props.customerLabel && props.customerLabel !== "—" ? props.customerLabel : null]
              .filter(Boolean)
              .join(" · ")
          : String(quickCtx || "").trim();
      const pdfHtml = buildQuickMaterialOrderPdfHtml({
        companyName: props.companyDisplayName || "Organizace",
        documentNumber: docNo,
        subject: quickSubject.trim(),
        jobLabel: props.jobLabel,
        customerLabel: ctxLine || null,
        bodyText: quickBody,
        note: quickNote.trim() || null,
        createdDateIso: dateIsoToday(),
      });
      const orderRef = await addDoc(
        collection(firestore, "companies", props.companyId, "jobs", props.jobId, "materialOrders"),
        {
          organizationId: props.companyId,
          jobId: props.jobId,
          orderKind: "quick_text",
          title: quickSubject.trim(),
          documentNumber: docNo,
          bodyText: quickBody,
          note: quickNote.trim() || null,
          recipientEmail: quickTo.trim().toLowerCase(),
          cc: quickCc.trim() || null,
          customerContext: ctxLine || null,
          pdfHtml,
          items: [],
          includeStatuses: [],
          orderSource: "quick_text",
          quickOrderStatus: "draft",
          createdAt: serverTimestamp(),
          createdBy: props.userId,
          createdByName: props.actorDisplayName || null,
        }
      );
      await sendJobDocumentEmailFromBrowser({
        companyId: props.companyId,
        jobId: props.jobId,
        type: "material_order",
        to: quickTo.trim(),
        cc: quickCc.trim() || undefined,
        subject: quickSubject.trim(),
        html: normalizeEmailBodyToHtml(
          `${quickBody.trim()}\n\n${quickNote.trim() ? `Poznámka: ${quickNote.trim()}\n` : ""}`
        ),
        materialOrderId: orderRef.id,
      });
      toast({ title: "Odesláno", description: "E-mail s PDF přílohou byl odeslán a záznam byl uložen." });
      setQuickOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Odeslání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setQuickSaving(false);
    }
  }, [
    firestore,
    includeJobCtx,
    props.actorDisplayName,
    props.companyDisplayName,
    props.companyId,
    props.customerLabel,
    props.jobId,
    props.jobLabel,
    props.userId,
    quickBody,
    quickCc,
    quickNote,
    quickSubject,
    quickTo,
    quickCtx,
    toast,
  ]);

  const quickStatusBadge = (st: QuickMaterialOrderStatus | undefined) => {
    const s = st ?? "draft";
    if (s === "draft") return <Badge variant="secondary">Koncept</Badge>;
    const label = QUICK_STATUS_LABEL[s as Exclude<QuickMaterialOrderStatus, "draft">] ?? s;
    return <Badge variant="outline">{label}</Badge>;
  };

  return (
    <div className="mb-4 shrink-0 space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Výrobní podklady</p>
        </div>
        {sheets.length === 0 ? (
          <p className="text-xs text-slate-500">Zatím žádný uložený výrobní list — použijte export PDF níže.</p>
        ) : (
          <ul className="space-y-1.5">
            {sheets.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{s.fileName}</p>
                  <p className="text-[11px] text-slate-500">
                    {formatTs(s.createdAt)} — {s.createdByName}
                    {s.productionStartedAt ? (
                      <span>
                        {" "}
                        · zahájeno {formatTs(s.productionStartedAt)}
                        {s.productionStartedByName ? ` (${s.productionStartedByName})` : ""}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-0.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {SHEET_STATUS_LABEL[(s.status ?? "ready") as ProductionSheetStatus] ?? s.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {s.fileUrl ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" asChild>
                        <a href={s.fileUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Otevřít
                        </a>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" asChild>
                        <a href={s.fileUrl} download={s.fileName}>
                          <Download className="mr-1 h-3 w-3" />
                          Stáhnout
                        </a>
                      </Button>
                    </>
                  ) : null}
                  {props.canMutate && s.status === "ready" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[11px]"
                      onClick={() => void setSheetProduction(s)}
                    >
                      Vyrábím
                    </Button>
                  ) : null}
                  {props.canMutate && s.status === "inProduction" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => void setSheetDone(s)}
                    >
                      Hotovo
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Objednávky materiálu</p>
          {props.canMutate ? (
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={openQuick}>
              <Mail className="h-3 w-3" />
              Rychlá objednávka materiálu
            </Button>
          ) : null}
        </div>
        {quickOrders.length === 0 ? (
          <p className="text-xs text-slate-500">Zatím žádná rychlá objednávka.</p>
        ) : (
          <ul className="space-y-1.5">
            {quickOrders.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{o.title}</p>
                  <p className="text-[11px] text-slate-500">
                    Komu: {o.recipientEmail || o.lastEmailSentTo || "—"} · {formatTs(o.sentAt)} ·{" "}
                    {o.sentByName || "—"}
                  </p>
                  <div className="mt-0.5">{quickStatusBadge(o.quickOrderStatus)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {o.fileUrl ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" asChild>
                        <a href={o.fileUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Otevřít
                        </a>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" asChild>
                        <a href={o.fileUrl} download>
                          <Download className="mr-1 h-3 w-3" />
                          Stáhnout
                        </a>
                      </Button>
                    </>
                  ) : null}
                  {props.canMutate && o.quickOrderStatus === "sent" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[11px]"
                      onClick={() => void setOrderOrdered(o)}
                    >
                      Objednáno
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Rychlá objednávka materiálu
            </DialogTitle>
            <DialogDescription>
              Text objednávky může být volný (např. rozměry skel). Odešle se stejným kanálem jako doklady z
              organizace; přílohou je PDF vygenerované na serveru.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Příjemce (e-mail)</Label>
              <Input
                value={quickTo}
                onChange={(e) => setQuickTo(e.target.value)}
                placeholder="dodavatel@example.cz"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kopie (CC)</Label>
              <Input
                value={quickCc}
                onChange={(e) => setQuickCc(e.target.value)}
                placeholder="více adres čárkou"
                className="h-9 text-sm"
              />
            </div>
            <DocumentEmailRecipientPicker
              firestore={firestore}
              companyId={props.companyId}
              toValue={quickTo}
              onToChange={setQuickTo}
              suggestionEmails={props.suggestionEmails}
            />
            <div className="space-y-1">
              <Label className="text-xs">Předmět</Label>
              <Input value={quickSubject} onChange={(e) => setQuickSubject(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Text objednávky</Label>
              <Textarea
                value={quickBody}
                onChange={(e) => setQuickBody(e.target.value)}
                className="min-h-[120px] text-sm"
                placeholder="Objednat skla:&#10;4 ks ESG 6 mm 1200 × 800…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poznámka</Label>
              <Textarea value={quickNote} onChange={(e) => setQuickNote(e.target.value)} className="min-h-[56px] text-sm" />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
              <Checkbox checked={includeJobCtx} onCheckedChange={(c) => setIncludeJobCtx(c === true)} />
              <span>Přidat do PDF kontext zakázky / zákazníka ({props.jobLabel})</span>
            </label>
            {!includeJobCtx ? (
              <div className="space-y-1">
                <Label className="text-xs">Vlastní řádek kontextu (volitelně)</Label>
                <Input value={quickCtx} onChange={(e) => setQuickCtx(e.target.value)} className="h-9 text-sm" />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setQuickOpen(false)} disabled={quickSaving}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void submitQuickOrder()} disabled={quickSaving}>
              {quickSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Odeslat objednávku
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
