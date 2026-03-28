"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { Plus, Minus, History, Loader2, Factory } from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessWarehousePortal } from "@/lib/warehouse-production-access";
import type { InventoryItemRow, InventoryMovementRow } from "@/lib/inventory-types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CARD = "border-slate-200 bg-white text-slate-900";

function movementLabel(t: string) {
  if (t === "in") return "Naskladnění";
  if (t === "out") return "Vyskladnění";
  if (t === "out_to_production") return "Do výroby";
  return t;
}

export default function SkladPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const { company, companyId } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<any>(userRef);
  const role = String(profile?.role || "employee");

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && profile?.employeeId && role === "employee"
        ? doc(firestore, "companies", companyId, "employees", String(profile.employeeId))
        : null,
    [firestore, companyId, profile?.employeeId, role]
  );
  const { data: employeeRow } = useDoc(employeeRef);

  const accessOk =
    company &&
    canAccessCompanyModule(company, "sklad", platformCatalog) &&
    userCanAccessWarehousePortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessWarehouse?: boolean } | null,
    });

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryItems"),
      orderBy("name"),
      limit(500)
    );
  }, [firestore, companyId]);

  const movementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryMovements"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
  }, [firestore, companyId]);

  const productionQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "production"),
      orderBy("updatedAt", "desc"),
      limit(100)
    );
  }, [firestore, companyId]);

  const { data: items, isLoading: itemsLoading } = useCollection(itemsQuery);
  const { data: movements, isLoading: movLoading } = useCollection(movementsQuery);
  const { data: productions } = useCollection(productionQuery);

  const [inOpen, setInOpen] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [inItemId, setInItemId] = useState<string>("");
  const [inQty, setInQty] = useState("1");
  const [inDate, setInDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inNote, setInNote] = useState("");
  const [inSupplier, setInSupplier] = useState("");
  const [inDocNo, setInDocNo] = useState("");
  const [inNewName, setInNewName] = useState("");
  const [inNewSku, setInNewSku] = useState("");
  const [inNewUnit, setInNewUnit] = useState("ks");
  const [inNewPrice, setInNewPrice] = useState("");
  const [inNewNote, setInNewNote] = useState("");
  const [inCreateNew, setInCreateNew] = useState(false);

  const [outItemId, setOutItemId] = useState("");
  const [outQty, setOutQty] = useState("1");
  const [outDate, setOutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [outNote, setOutNote] = useState("");
  const [outDest, setOutDest] = useState("");
  const [outToProduction, setOutToProduction] = useState(false);
  const [outProductionId, setOutProductionId] = useState("");

  const itemList = useMemo(
    () => (Array.isArray(items) ? (items as InventoryItemRow[]) : []),
    [items]
  );
  const movList = useMemo(
    () => (Array.isArray(movements) ? (movements as InventoryMovementRow[]) : []),
    [movements]
  );
  const prodList = useMemo(() => (Array.isArray(productions) ? productions : []), [productions]);

  const vyrobaEnabled =
    company && canAccessCompanyModule(company, "vyroba", platformCatalog);

  if (!user || !firestore || !companyId) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessOk) {
    return (
      <Card className={CARD}>
        <CardContent className="py-10 text-center text-slate-700">
          Nemáte přístup ke skladu nebo není modul aktivní.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět na přehled
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const resetIn = () => {
    setInItemId("");
    setInQty("1");
    setInDate(new Date().toISOString().slice(0, 10));
    setInNote("");
    setInSupplier("");
    setInDocNo("");
    setInNewName("");
    setInNewSku("");
    setInNewUnit("ks");
    setInNewPrice("");
    setInNewNote("");
    setInCreateNew(false);
  };

  const resetOut = () => {
    setOutItemId("");
    setOutQty("1");
    setOutDate(new Date().toISOString().slice(0, 10));
    setOutNote("");
    setOutDest("");
    setOutToProduction(false);
    setOutProductionId("");
  };

  const submitInbound = async () => {
    if (!user) return;
    const qty = Number(String(inQty).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    setSaving(true);
    try {
      await runTransaction(firestore, async (tx) => {
        let itemRef;
        let itemName: string;
        let unit: string;
        let itemId: string;

        if (inCreateNew) {
          const name = inNewName.trim();
          if (!name) throw new Error("Vyplňte název položky.");
          itemRef = doc(collection(firestore, "companies", companyId, "inventoryItems"));
          itemId = itemRef.id;
          itemName = name;
          unit = inNewUnit.trim() || "ks";
          const unitPrice =
            inNewPrice.trim() === "" ? null : Number(String(inNewPrice).replace(",", "."));
          tx.set(itemRef, {
            companyId,
            name,
            sku: inNewSku.trim() || null,
            unit,
            quantity: qty,
            unitPrice: Number.isFinite(unitPrice as number) ? unitPrice : null,
            note: inNewNote.trim() || null,
            createdAt: serverTimestamp(),
            createdBy: user.uid,
            updatedAt: serverTimestamp(),
          });
        } else {
          if (!inItemId) throw new Error("Vyberte položku.");
          itemRef = doc(firestore, "companies", companyId, "inventoryItems", inItemId);
          const snap = await tx.get(itemRef);
          if (!snap.exists()) throw new Error("Položka neexistuje.");
          const d = snap.data() as InventoryItemRow;
          itemId = inItemId;
          itemName = d.name;
          unit = d.unit || "ks";
          const prev = Number(d.quantity ?? 0);
          tx.update(itemRef, {
            quantity: prev + qty,
            updatedAt: serverTimestamp(),
          });
        }

        const movRef = doc(collection(firestore, "companies", companyId, "inventoryMovements"));
        tx.set(movRef, {
          companyId,
          type: "in",
          itemId,
          itemName,
          quantity: qty,
          unit,
          date: inDate,
          note: inNote.trim() || null,
          supplier: inSupplier.trim() || null,
          documentNo: inDocNo.trim() || null,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });
      });
      toast({ title: "Naskladněno", description: "Pohyb byl zaznamenán." });
      setInOpen(false);
      resetIn();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const submitOutbound = async () => {
    if (!user) return;
    const qty = Number(String(outQty).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    if (!outItemId) {
      toast({ variant: "destructive", title: "Vyberte položku." });
      return;
    }
    if (outToProduction) {
      if (!vyrobaEnabled) {
        toast({ variant: "destructive", title: "Modul Výroba není u firmy aktivní." });
        return;
      }
      if (!outProductionId) {
        toast({ variant: "destructive", title: "Vyberte výrobní záznam." });
        return;
      }
    }
    setSaving(true);
    try {
      await runTransaction(firestore, async (tx) => {
        const itemRef = doc(firestore, "companies", companyId, "inventoryItems", outItemId);
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) throw new Error("Položka neexistuje.");
        const d = itemSnap.data() as InventoryItemRow;
        const prev = Number(d.quantity ?? 0);
        if (prev < qty) throw new Error("Nedostatek na skladě.");
        const unit = d.unit || "ks";
        const itemName = d.name;

        tx.update(itemRef, {
          quantity: prev - qty,
          updatedAt: serverTimestamp(),
        });

        const movRef = doc(collection(firestore, "companies", companyId, "inventoryMovements"));
        const movType = outToProduction ? "out_to_production" : "out";
        let productionTitle: string | null = null;

        if (outToProduction && outProductionId) {
          const prodRef = doc(firestore, "companies", companyId, "production", outProductionId);
          const pSnap = await tx.get(prodRef);
          if (!pSnap.exists()) throw new Error("Výroba nenalezena.");
          const p = pSnap.data() as { title?: string; materials?: unknown[] };
          productionTitle = (p.title as string) || "";
          const materials = Array.isArray(p.materials) ? [...p.materials] : [];
          materials.push({
            movementId: movRef.id,
            itemId: outItemId,
            itemName,
            quantity: qty,
            unit,
            addedAt: new Date().toISOString(),
          });
          tx.update(prodRef, {
            materials,
            updatedAt: serverTimestamp(),
          });
        }

        tx.set(movRef, {
          companyId,
          type: movType,
          itemId: outItemId,
          itemName,
          quantity: qty,
          unit,
          date: outDate,
          note: outNote.trim() || null,
          destination: outDest.trim() || null,
          productionId: outToProduction ? outProductionId : null,
          productionTitle,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });
      });
      toast({ title: "Vyskladněno", description: "Pohyb byl zaznamenán." });
      setOutOpen(false);
      resetOut();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">Sklad</h1>
          <p className="portal-page-description text-slate-700 mt-1">
            Položky, naskladnění, vyskladnění a historie včetně přesunu do výroby.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              resetIn();
              setInOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Naskladnit
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-slate-300 bg-white text-slate-900"
            onClick={() => {
              resetOut();
              setOutOpen(true);
            }}
          >
            <Minus className="h-4 w-4" /> Vyskladnit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={CARD}>
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg text-slate-900">Skladové položky</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 max-h-[480px] overflow-y-auto">
            {itemsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            ) : itemList.length === 0 ? (
              <p className="text-sm text-slate-600">Zatím žádné položky — použijte Naskladnit.</p>
            ) : (
              itemList.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm"
                >
                  <div className="font-medium text-slate-900">{row.name}</div>
                  <div className="text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {Number(row.quantity ?? 0)} {row.unit || "ks"}
                    </span>
                    {row.sku ? <span>Kód: {row.sku}</span> : null}
                    {row.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? (
                      <span>{Number(row.unitPrice)} Kč / {row.unit || "j."}</span>
                    ) : null}
                  </div>
                  {row.note ? <p className="text-xs text-slate-500 mt-1">{row.note}</p> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className={CARD}>
          <CardHeader className="border-b border-slate-100 flex flex-row items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg text-slate-900">Historie pohybů</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 max-h-[480px] overflow-y-auto">
            {movLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            ) : movList.length === 0 ? (
              <p className="text-sm text-slate-600">Zatím žádné pohyby.</p>
            ) : (
              movList.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-slate-200 p-3 text-sm text-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {movementLabel(m.type)}
                    </Badge>
                    <span className="font-medium">{m.itemName}</span>
                    <span>
                      {m.quantity} {m.unit}
                    </span>
                    <span className="text-slate-500">{m.date}</span>
                  </div>
                  {m.note ? <p className="text-xs mt-1 text-slate-600">{m.note}</p> : null}
                  {m.supplier ? (
                    <p className="text-xs text-slate-500">Dodavatel: {m.supplier}</p>
                  ) : null}
                  {m.documentNo ? (
                    <p className="text-xs text-slate-500">Doklad: {m.documentNo}</p>
                  ) : null}
                  {m.destination ? (
                    <p className="text-xs text-slate-500">Cíl: {m.destination}</p>
                  ) : null}
                  {m.productionId ? (
                    <p className="text-xs mt-1">
                      <Link
                        href={`/portal/vyroba/${m.productionId}`}
                        className="text-primary underline inline-flex items-center gap-1"
                      >
                        <Factory className="h-3 w-3" /> Výroba: {m.productionTitle || m.productionId}
                      </Link>
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={inOpen} onOpenChange={setInOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Naskladnění</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <Checkbox
                id="in-new"
                checked={inCreateNew}
                onCheckedChange={(v) => setInCreateNew(v === true)}
              />
              <Label htmlFor="in-new">Nová položka</Label>
            </div>
            {inCreateNew ? (
              <>
                <div className="space-y-1">
                  <Label>Název</Label>
                  <Input
                    className="bg-white border-slate-200"
                    value={inNewName}
                    onChange={(e) => setInNewName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Kód / označení</Label>
                    <Input
                      className="bg-white border-slate-200"
                      value={inNewSku}
                      onChange={(e) => setInNewSku(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Jednotka</Label>
                    <Input
                      className="bg-white border-slate-200"
                      value={inNewUnit}
                      onChange={(e) => setInNewUnit(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Cena za jednotku (volitelně)</Label>
                  <Input
                    className="bg-white border-slate-200"
                    type="number"
                    value={inNewPrice}
                    onChange={(e) => setInNewPrice(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Poznámka u položky</Label>
                  <Input
                    className="bg-white border-slate-200"
                    value={inNewNote}
                    onChange={(e) => setInNewNote(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <Label>Položka</Label>
                <Select value={inItemId} onValueChange={setInItemId}>
                  <SelectTrigger className="bg-white border-slate-200">
                    <SelectValue placeholder="Vyberte…" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    {itemList.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({Number(i.quantity ?? 0)} {i.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Množství</Label>
              <Input
                className="bg-white border-slate-200"
                value={inQty}
                onChange={(e) => setInQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum</Label>
              <Input
                type="date"
                className="bg-white border-slate-200"
                value={inDate}
                onChange={(e) => setInDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Poznámka k pohybu</Label>
              <Input
                className="bg-white border-slate-200"
                value={inNote}
                onChange={(e) => setInNote(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Dodavatel (volitelně)</Label>
              <Input
                className="bg-white border-slate-200"
                value={inSupplier}
                onChange={(e) => setInSupplier(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Číslo dokladu (volitelně)</Label>
              <Input
                className="bg-white border-slate-200"
                value={inDocNo}
                onChange={(e) => setInDocNo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving} onClick={() => void submitInbound()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outOpen} onOpenChange={setOutOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Vyskladnění</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Položka</Label>
              <Select value={outItemId} onValueChange={setOutItemId}>
                <SelectTrigger className="bg-white border-slate-200">
                  <SelectValue placeholder="Vyberte…" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {itemList.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} ({Number(i.quantity ?? 0)} {i.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Množství</Label>
              <Input
                className="bg-white border-slate-200"
                value={outQty}
                onChange={(e) => setOutQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum</Label>
              <Input
                type="date"
                className="bg-white border-slate-200"
                value={outDate}
                onChange={(e) => setOutDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Poznámka</Label>
              <Input
                className="bg-white border-slate-200"
                value={outNote}
                onChange={(e) => setOutNote(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Kam / účel (volitelně)</Label>
              <Input
                className="bg-white border-slate-200"
                value={outDest}
                onChange={(e) => setOutDest(e.target.value)}
              />
            </div>
            {vyrobaEnabled ? (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="out-prod"
                    checked={outToProduction}
                    onCheckedChange={(v) => setOutToProduction(v === true)}
                  />
                  <Label htmlFor="out-prod">Poslat do výroby</Label>
                </div>
                {outToProduction ? (
                  <div className="space-y-1">
                    <Label>Výrobní záznam</Label>
                    <Select value={outProductionId} onValueChange={setOutProductionId}>
                      <SelectTrigger className="bg-white border-slate-200">
                        <SelectValue placeholder="Vyberte výrobu…" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        {prodList.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title || p.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      Nejdřív založte výrobu v sekci{" "}
                      <Link href="/portal/vyroba" className="text-primary underline">
                        Výroba
                      </Link>
                      .
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOutOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving} onClick={() => void submitOutbound()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
