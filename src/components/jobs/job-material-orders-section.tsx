"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  FileDown,
  Pencil,
  Trash2,
  Loader2,
  Printer,
} from "lucide-react";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import { useToast } from "@/hooks/use-toast";
import { buildMaterialOrderHtml } from "@/lib/material-order-a4-html";
import { printInvoiceHtmlDocument } from "@/lib/print-html";

export type MaterialItemStatus =
  | "to_order"
  | "ordered"
  | "from_stock"
  | "delivered";

const STATUS_LABEL: Record<MaterialItemStatus, string> = {
  to_order: "Potřeba objednat",
  ordered: "Objednáno",
  from_stock: "Ze skladu",
  delivered: "Dodáno",
};

const STATUS_BADGE: Record<MaterialItemStatus, string> = {
  to_order: "bg-amber-600 text-white",
  ordered: "bg-blue-700 text-white",
  from_stock: "bg-emerald-700 text-white",
  delivered: "bg-slate-800 text-white",
};

type MaterialItemDoc = {
  id: string;
  jobId: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string | null;
  status: MaterialItemStatus;
  supplier?: string | null;
  orderedAt?: string | null; // ISO YYYY-MM-DD
  stockItemId?: string | null;
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};

type MaterialOrderDoc = {
  id: string;
  jobId: string;
  documentNumber: string;
  title: string;
  createdAt?: unknown;
  createdBy: string;
  /** snapshot položek v době exportu */
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    note?: string | null;
    supplier?: string | null;
    status?: string | null;
  }>;
  pdfHtml: string;
  /** co bylo zahrnuto */
  includeStatuses: string[];
};

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function safeQty(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function dateIsoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function JobMaterialOrdersSection(props: {
  companyId: string;
  companyDisplayName: string;
  jobId: string;
  job: Record<string, unknown>;
  customerName: string;
  customerAddressLines: string;
  userId: string;
  canManage: boolean;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<MaterialItemDoc | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [includeOrderedInPdf, setIncludeOrderedInPdf] = useState(true);
  const [includeToOrderInPdf, setIncludeToOrderInPdf] = useState(true);

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId || !props.jobId) return null;
    return query(
      collection(
        firestore,
        "companies",
        props.companyId,
        "jobs",
        props.jobId,
        "materialItems"
      ),
      orderBy("createdAt", "desc")
    );
  }, [firestore, props.companyId, props.jobId]);

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId || !props.jobId) return null;
    return query(
      collection(
        firestore,
        "companies",
        props.companyId,
        "jobs",
        props.jobId,
        "materialOrders"
      ),
      orderBy("createdAt", "desc")
    );
  }, [firestore, props.companyId, props.jobId]);

  const { data: itemsRaw, isLoading: itemsLoading } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: ordersLoading } = useCollection(ordersQuery);

  const items = useMemo(() => {
    const rows = Array.isArray(itemsRaw) ? (itemsRaw as MaterialItemDoc[]) : [];
    return rows.map((r) => ({
      ...r,
      id: String((r as { id?: string }).id ?? ""),
      name: trim((r as { name?: unknown }).name),
      quantity: safeQty((r as { quantity?: unknown }).quantity),
      unit: trim((r as { unit?: unknown }).unit) || "ks",
      status: (String((r as { status?: unknown }).status ?? "to_order") as MaterialItemStatus) || "to_order",
      note: trim((r as { note?: unknown }).note) || null,
      supplier: trim((r as { supplier?: unknown }).supplier) || null,
      orderedAt: trim((r as { orderedAt?: unknown }).orderedAt) || null,
      stockItemId: trim((r as { stockItemId?: unknown }).stockItemId) || null,
      createdBy: String((r as { createdBy?: unknown }).createdBy ?? ""),
    }));
  }, [itemsRaw]);

  const orders = useMemo(() => {
    const rows = Array.isArray(ordersRaw) ? (ordersRaw as MaterialOrderDoc[]) : [];
    return rows.map((r) => ({
      ...r,
      id: String((r as { id?: string }).id ?? ""),
      documentNumber: trim((r as { documentNumber?: unknown }).documentNumber),
      title: trim((r as { title?: unknown }).title) || "Objednávka materiálu",
      createdBy: String((r as { createdBy?: unknown }).createdBy ?? ""),
      pdfHtml: String((r as { pdfHtml?: unknown }).pdfHtml ?? ""),
    }));
  }, [ordersRaw]);

  const byStatus = useMemo(() => {
    const g: Record<MaterialItemStatus, MaterialItemDoc[]> = {
      to_order: [],
      ordered: [],
      from_stock: [],
      delivered: [],
    };
    for (const r of items) {
      const s = r.status in g ? (r.status as MaterialItemStatus) : "to_order";
      g[s].push(r);
    }
    return g;
  }, [items]);

  const openNew = () => {
    setEditRow({
      id: "",
      jobId: props.jobId,
      name: "",
      quantity: 1,
      unit: "ks",
      note: null,
      status: "to_order",
      supplier: null,
      orderedAt: null,
      stockItemId: null,
      createdBy: props.userId,
    });
    setEditOpen(true);
  };

  const openEdit = (row: MaterialItemDoc) => {
    setEditRow({ ...row });
    setEditOpen(true);
  };

  const saveItem = async () => {
    if (!firestore || !props.companyId || !props.jobId || !props.userId) return;
    if (!editRow) return;
    if (!props.canManage) {
      toast({
        variant: "destructive",
        title: "Nelze upravit",
        description: "Chybí oprávnění pro úpravu materiálu u zakázky.",
      });
      return;
    }
    const name = trim(editRow.name);
    if (!name) {
      toast({ variant: "destructive", title: "Chybí název", description: "Vyplňte název položky." });
      return;
    }
    const qty = safeQty(editRow.quantity);
    if (!(qty > 0)) {
      toast({ variant: "destructive", title: "Množství", description: "Množství musí být > 0." });
      return;
    }
    const unit = trim(editRow.unit) || "ks";
    const status = editRow.status || "to_order";

    setSaving(true);
    try {
      const payload = {
        jobId: props.jobId,
        name,
        quantity: qty,
        unit,
        status,
        note: trim(editRow.note) || null,
        supplier: trim(editRow.supplier) || null,
        orderedAt: trim(editRow.orderedAt) || null,
        stockItemId: trim(editRow.stockItemId) || null,
        updatedAt: serverTimestamp(),
      } as const;

      if (!editRow.id) {
        await addDoc(
          collection(
            firestore,
            "companies",
            props.companyId,
            "jobs",
            props.jobId,
            "materialItems"
          ),
          {
            ...payload,
            createdAt: serverTimestamp(),
            createdBy: props.userId,
          }
        );
        toast({ title: "Uloženo", description: "Materiálová položka byla přidána." });
      } else {
        await updateDoc(
          doc(
            firestore,
            "companies",
            props.companyId,
            "jobs",
            props.jobId,
            "materialItems",
            editRow.id
          ),
          payload as unknown as UpdateData<DocumentData>
        );
        toast({ title: "Uloženo", description: "Materiálová položka byla upravena." });
      }
      setEditOpen(false);
      setEditRow(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (row: MaterialItemDoc) => {
    if (!firestore || !props.companyId || !props.jobId) return;
    if (!props.canManage) return;
    if (!window.confirm("Smazat materiálovou položku?")) return;
    try {
      await deleteDoc(
        doc(
          firestore,
          "companies",
          props.companyId,
          "jobs",
          props.jobId,
          "materialItems",
          row.id
        )
      );
      toast({ title: "Smazáno", description: "Položka byla odstraněna." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const exportMaterialOrderPdf = async () => {
    if (!firestore || !props.companyId || !props.jobId || !props.userId) return;
    if (!props.canManage) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit objednávku",
        description: "Chybí oprávnění pro export objednávky.",
      });
      return;
    }
    const include: MaterialItemStatus[] = [];
    if (includeToOrderInPdf) include.push("to_order");
    if (includeOrderedInPdf) include.push("ordered");
    if (include.length === 0) {
      toast({
        variant: "destructive",
        title: "Vyberte položky",
        description: "Zvolte alespoň jeden stav, který se má zahrnout do PDF.",
      });
      return;
    }

    const selected = items.filter((i) => include.includes(i.status));
    if (selected.length === 0) {
      toast({
        variant: "destructive",
        title: "Žádné položky",
        description: "Pro zvolené stavy nejsou žádné položky k exportu.",
      });
      return;
    }

    setCreatingPdf(true);
    try {
      const docNo = await allocateNextDocumentNumber(
        firestore,
        props.companyId,
        "OBJ"
      );
      const jobName =
        trim(props.job.name) ||
        trim(props.job.title) ||
        trim((props.job as { jobName?: unknown }).jobName) ||
        "Zakázka";
      const jobNo =
        trim((props.job as { jobTag?: unknown }).jobTag) ||
        trim((props.job as { number?: unknown }).number) ||
        null;
      const jobAddressLines =
        trim((props.job as { address?: unknown }).address) ||
        trim((props.job as { customerAddress?: unknown }).customerAddress) ||
        props.customerAddressLines ||
        "—";

      const html = buildMaterialOrderHtml({
        title: "Objednávka materiálu",
        companyName: props.companyDisplayName || "Organizace",
        jobName,
        jobNumber: jobNo,
        customerName: props.customerName || "—",
        jobAddressLines,
        documentNumber: docNo,
        createdDateIso: dateIsoToday(),
        items: selected.map((r) => ({
          name: r.name,
          quantity: r.quantity,
          unit: r.unit,
          note: r.note,
          supplier: r.supplier,
        })),
        note: null,
      });

      const orderRef = await addDoc(
        collection(
          firestore,
          "companies",
          props.companyId,
          "jobs",
          props.jobId,
          "materialOrders"
        ),
        {
          jobId: props.jobId,
          title: "Objednávka materiálu",
          documentNumber: docNo,
          createdAt: serverTimestamp(),
          createdBy: props.userId,
          includeStatuses: include,
          items: selected.map((r) => ({
            name: r.name,
            quantity: r.quantity,
            unit: r.unit,
            note: r.note ?? null,
            supplier: r.supplier ?? null,
            status: r.status,
          })),
          pdfHtml: html,
        }
      );

      toast({ title: "Objednávka vytvořena", description: `Doklad ${docNo} byl uložen.` });
      // rovnou otevřít tisk
      printInvoiceHtmlDocument(html, `Objednávka ${docNo}`);
      // a umožnit proklik na detail zakázky / sekce: odkaz na /portal/documents zatím není potřeba
      console.log("material order id", orderRef.id);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Export se nezdařil",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setCreatingPdf(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Materiál a objednávky</CardTitle>
          <p className="text-xs text-muted-foreground">
            Evidence toho, co je potřeba objednat, co je objednáno a co je ze skladu. Vše je navázané na tuto zakázku.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={!props.canManage}
            onClick={openNew}
          >
            <Plus className="h-4 w-4" />
            Přidat položku
          </Button>
          <Button
            type="button"
            className="gap-2"
            disabled={!props.canManage || creatingPdf}
            onClick={() => void exportMaterialOrderPdf()}
          >
            {creatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Export objednávky do PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-700">Zahrnout do PDF</Label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeToOrderInPdf}
              onChange={(e) => setIncludeToOrderInPdf(e.target.checked)}
            />
            Potřeba objednat
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeOrderedInPdf}
              onChange={(e) => setIncludeOrderedInPdf(e.target.checked)}
            />
            Objednáno
          </label>
        </div>

        {itemsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatím nejsou evidované žádné materiálové položky.
          </p>
        ) : (
          <div className="space-y-4">
            {(Object.keys(byStatus) as MaterialItemStatus[]).map((s) => {
              const list = byStatus[s];
              if (!list.length) return null;
              return (
                <div key={s} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {STATUS_LABEL[s]} <span className="text-muted-foreground">({list.length})</span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {list.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-950">{r.name}</span>
                            <Badge className={`h-5 px-2 text-[10px] ${STATUS_BADGE[r.status]}`}>
                              {STATUS_LABEL[r.status]}
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-700">
                            {r.quantity} {r.unit}
                            {r.supplier ? <span className="ml-2">· Dodavatel: {r.supplier}</span> : null}
                            {r.stockItemId ? (
                              <span className="ml-2">
                                · Sklad: <code className="text-[11px]">{r.stockItemId}</code>
                              </span>
                            ) : null}
                          </div>
                          {r.note ? (
                            <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                              {r.note}
                            </div>
                          ) : null}
                        </div>
                        {props.canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => openEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" /> Upravit
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => void deleteItem(r)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Vytvořené objednávky</h3>
          {ordersLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná objednávka nebyla vytvořena.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-950 truncate">{o.title}</div>
                    <div className="text-xs text-muted-foreground">{o.documentNumber}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => {
                        if (!o.pdfHtml || !o.pdfHtml.trim()) {
                          toast({ variant: "destructive", title: "Chybí náhled", description: "U dokladu není uložený obsah." });
                          return;
                        }
                        printInvoiceHtmlDocument(o.pdfHtml, `Objednávka ${o.documentNumber}`);
                      }}
                    >
                      <Printer className="h-4 w-4" />
                      Tisk / PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={(o) => !o && (setEditOpen(false), setEditRow(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow?.id ? "Upravit položku" : "Přidat položku"}</DialogTitle>
            <DialogDescription>
              Evidence materiálu navázaná na zakázku. Stav určuje, zda se položka dostane do objednávky.
            </DialogDescription>
          </DialogHeader>
          {editRow ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1">
                <Label>Název</Label>
                <Input value={editRow.name} onChange={(e) => setEditRow({ ...editRow, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Množství</Label>
                <Input
                  type="number"
                  value={editRow.quantity}
                  onChange={(e) => setEditRow({ ...editRow, quantity: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label>Jednotka</Label>
                <Input value={editRow.unit} onChange={(e) => setEditRow({ ...editRow, unit: e.target.value })} />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Stav</Label>
                <Select
                  value={editRow.status}
                  onValueChange={(v) => setEditRow({ ...editRow, status: v as MaterialItemStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to_order">{STATUS_LABEL.to_order}</SelectItem>
                    <SelectItem value="ordered">{STATUS_LABEL.ordered}</SelectItem>
                    <SelectItem value="from_stock">{STATUS_LABEL.from_stock}</SelectItem>
                    <SelectItem value="delivered">{STATUS_LABEL.delivered}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Dodavatel (nepovinné)</Label>
                <Input
                  value={editRow.supplier ?? ""}
                  onChange={(e) => setEditRow({ ...editRow, supplier: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Skladová položka ID (nepovinné)</Label>
                <Input
                  value={editRow.stockItemId ?? ""}
                  onChange={(e) => setEditRow({ ...editRow, stockItemId: e.target.value })}
                  placeholder="Např. inventoryItems/{id}"
                />
                <p className="text-[11px] text-muted-foreground">
                  Pokud je skladový modul aktivní, můžete sem vložit ID položky ze skladu; nic nespadne, pokud sklad nepoužíváte.
                </p>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Poznámka</Label>
                <Textarea value={editRow.note ?? ""} onChange={(e) => setEditRow({ ...editRow, note: e.target.value })} rows={3} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => (setEditOpen(false), setEditRow(null))}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveItem()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

