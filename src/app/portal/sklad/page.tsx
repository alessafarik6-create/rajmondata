"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import {
  Plus,
  Minus,
  History,
  Loader2,
  Factory,
  Upload,
  Pencil,
  Trash2,
  Search,
  ImageIcon,
} from "lucide-react";
import {
  useUser,
  useFirebase,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
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
import {
  userCanAccessWarehousePortal,
  userCanManageWarehouseInventory,
} from "@/lib/warehouse-production-access";
import type { InventoryItemRow, InventoryMovementRow } from "@/lib/inventory-types";
import {
  formatInventoryMoneyCzk,
  inventoryLineValueCzk,
  isActiveInventoryItem,
} from "@/lib/inventory-helpers";
import { InventoryItemEditDialog } from "@/components/warehouse/inventory-item-edit-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WarehouseImportDialog } from "@/components/warehouse/warehouse-import-dialog";
import { DEFAULT_STOCK_CATEGORIES } from "@/lib/stock-categories";

const CARD = "border-slate-200 bg-white text-slate-900";

function movementLabel(t: string) {
  if (t === "in") return "Naskladnění";
  if (t === "out") return "Vyskladnění";
  if (t === "out_to_production") return "Přesun do výroby";
  if (t === "out_to_job") return "Výdej na zakázku";
  if (t === "partial_out") return "Částečný výdej";
  if (t === "remainder_created") return "Vznik zbytku";
  if (t === "remainder_return") return "Vrácení zbytku";
  if (t === "transfer_internal") return "Interní přesun";
  if (t === "admin_adjustment") return "Korekce (admin)";
  if (t === "adjustment") return "Úprava množství";
  if (t === "item_edit") return "Úprava položky";
  return t;
}

function formatMovementUser(uid: string | null | undefined): string {
  if (!uid) return "—";
  if (uid.length <= 10) return uid;
  return `${uid.slice(0, 8)}…`;
}

export default function SkladPage() {
  const { user } = useUser();
  const { firestore, areServicesAvailable } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const { company, companyId } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () =>
      areServicesAvailable && user && firestore
        ? doc(firestore, "users", user.uid)
        : null,
    [areServicesAvailable, firestore, user?.uid]
  );
  const { data: profile } = useDoc<any>(userRef);
  const role = String(profile?.role || "employee");

  const employeeRef = useMemoFirebase(
    () =>
      areServicesAvailable &&
      firestore &&
      companyId &&
      profile?.employeeId &&
      role === "employee"
        ? doc(firestore, "companies", companyId, "employees", String(profile.employeeId))
        : null,
    [areServicesAvailable, firestore, companyId, profile?.employeeId, role]
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
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryItems"),
      orderBy("name"),
      limit(500)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const categoriesQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "stockCategories"),
      orderBy("order"),
      orderBy("name"),
      limit(200)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const movementsQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryMovements"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const productionQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "production"),
      orderBy("updatedAt", "desc"),
      limit(100)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const deliveryNotesQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "documents"),
      where("documentType", "==", "delivery_note"),
      where("assignmentType", "==", "warehouse"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const { data: items, isLoading: itemsLoading } = useCollection(itemsQuery);
  const { data: stockCategoriesRaw = [] } = useCollection(categoriesQuery, {
    suppressGlobalPermissionError: true as const,
  });
  const { data: movements, isLoading: movLoading } = useCollection(movementsQuery);
  const { data: productions } = useCollection(productionQuery);
  const { data: deliveryNotes } = useCollection(deliveryNotesQuery);

  const [inOpen, setInOpen] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  const stockCategories = useMemo(() => {
    const raw = Array.isArray(stockCategoriesRaw) ? stockCategoriesRaw : [];
    return raw
      .map((c: any) => ({
        id: String(c?.id ?? ""),
        name: String(c?.name ?? ""),
        order: Number(c?.order) || 0,
      }))
      .filter((c) => c.id && c.name)
      .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, "cs"));
  }, [stockCategoriesRaw]);
  const stockCategoryById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of stockCategories) m.set(c.id, c.name);
    return m;
  }, [stockCategories]);
  const movList = useMemo(
    () => (Array.isArray(movements) ? (movements as InventoryMovementRow[]) : []),
    [movements]
  );
  const prodList = useMemo(() => (Array.isArray(productions) ? productions : []), [productions]);

  const canManageInventory = userCanManageWarehouseInventory({
    role,
    globalRoles: profile?.globalRoles,
  });

  const activeItemList = useMemo(
    () => itemList.filter((row) => isActiveInventoryItem(row)),
    [itemList]
  );

  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [searchQuery, setSearchQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItemRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItemRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    let rows = activeItemList;
    if (categoryFilter !== "__all__") {
      if (categoryFilter === "__none__") {
        rows = rows.filter((r) => !String(r.categoryId ?? "").trim());
      } else {
        rows = rows.filter((r) => String(r.categoryId ?? "").trim() === categoryFilter);
      }
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const name = String(r.name ?? "").toLowerCase();
        const sku = String(r.sku ?? "").toLowerCase();
        return name.includes(q) || sku.includes(q);
      });
    }
    return rows;
  }, [activeItemList, categoryFilter, searchQuery]);

  const [catManageOpen, setCatManageOpen] = useState(false);
  const [catBusy, setCatBusy] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const warehouseStats = useMemo(() => {
    let totalQty = 0;
    let totalValue = 0;
    for (const row of activeItemList) {
      totalQty += Number(row.quantity ?? 0);
      totalValue += inventoryLineValueCzk(row);
    }
    return {
      itemCount: activeItemList.length,
      totalQty,
      totalValue,
    };
  }, [activeItemList]);

  const vyrobaEnabled =
    company && canAccessCompanyModule(company, "vyroba", platformCatalog);

  if (!user || !areServicesAvailable || !companyId) {
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
    if (!user || !areServicesAvailable || !firestore || !companyId) return;
    const qty = Number(String(inQty).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    setSaving(true);
    try {
      let inboundMovementId: string | null = null;
      let inboundItemName = "";
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
            materialCategory: null,
            categoryId: null,
            categoryName: null,
            unit,
            quantity: qty,
            unitPrice: Number.isFinite(unitPrice as number) ? unitPrice : null,
            vatRate: null,
            supplier: null,
            imageUrl: null,
            note: inNewNote.trim() || null,
            isDeleted: false,
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
          if (d.isDeleted === true) {
            throw new Error("Tato položka byla odstraněna z přehledu. Vyberte jinou nebo vytvořte novou.");
          }
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
        inboundMovementId = movRef.id;
        inboundItemName = itemName;
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
      if (inboundMovementId) {
        void sendModuleEmailNotificationFromBrowser({
          companyId,
          module: "warehouse",
          eventKey: "stockIn",
          entityId: inboundMovementId,
          title: "Naskladnění",
          lines: [`Položka: ${inboundItemName || "—"}`, `Množství: ${qty}`],
          actionPath: "/portal/sklad",
        });
      }
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

  const createCategory = async () => {
    if (!user || !firestore || !companyId) return;
    const name = newCatName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Vyplňte název kategorie." });
      return;
    }
    setCatBusy(true);
    try {
      const nextOrder = stockCategories.length
        ? Math.max(...stockCategories.map((c) => Number(c.order) || 0)) + 10
        : 10;
      const ref = doc(collection(firestore, "companies", companyId, "stockCategories"));
      await setDoc(ref, {
        id: ref.id,
        companyId,
        name,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
      });
      setNewCatName("");
      toast({ title: "Kategorie vytvořena" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Vytvoření kategorie se nezdařilo.",
      });
    } finally {
      setCatBusy(false);
    }
  };

  const renameCategory = async (id: string, name: string) => {
    if (!user || !firestore || !companyId) return;
    const next = name.trim();
    if (!next) return;
    setCatBusy(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "stockCategories", id), {
        name: next,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Kategorie upravena" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setCatBusy(false);
    }
  };

  const updateCategoryOrder = async (id: string, order: number) => {
    if (!user || !firestore || !companyId) return;
    if (!Number.isFinite(order)) return;
    setCatBusy(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "stockCategories", id), {
        order,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setCatBusy(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!user || !firestore || !companyId) return;
    setCatBusy(true);
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "stockCategories", id));
      toast({
        title: "Kategorie odstraněna",
        description: "Kategorie byla smazána (položky zůstávají beze změny).",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Odstranění se nezdařilo.",
      });
    } finally {
      setCatBusy(false);
    }
  };

  const seedDefaults = async () => {
    if (!user || !firestore || !companyId) return;
    setCatBusy(true);
    try {
      const existing = new Set(stockCategories.map((c) => c.name.toLowerCase()));
      const toCreate = DEFAULT_STOCK_CATEGORIES.filter((c) => !existing.has(c.name.toLowerCase()));
      for (const c of toCreate) {
        const ref = doc(collection(firestore, "companies", companyId, "stockCategories"));
        await setDoc(ref, {
          id: ref.id,
          companyId,
          name: c.name,
          order: c.order,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
        });
      }
      toast({ title: "Výchozí kategorie vytvořeny" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Vytvoření se nezdařilo.",
      });
    } finally {
      setCatBusy(false);
    }
  };

  const submitOutbound = async () => {
    if (!user || !areServicesAvailable || !firestore || !companyId) return;
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
      let outboundMovementId: string | null = null;
      let outboundItemName = "";
      /** ID pohybu musí být známé před zápisem do výroby (movementId na řádku materiálu). */
      const movRef = doc(
        collection(firestore, "companies", companyId, "inventoryMovements")
      );
      outboundMovementId = movRef.id;

      await runTransaction(firestore, async (tx) => {
        const itemRef = doc(
          firestore,
          "companies",
          companyId,
          "inventoryItems",
          outItemId
        );
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error("Načtení skladu: položka neexistuje.");
        }
        const d = itemSnap.data() as InventoryItemRow;
        if (d.isDeleted === true) {
          throw new Error("Načtení skladu: položka byla odstraněna z přehledu.");
        }
        const prev = Number(d.quantity ?? 0);
        if (prev < qty) {
          throw new Error("Na skladě není dostatek materiálu (odečíst nelze více než je skladem).");
        }
        const unit = d.unit || "ks";
        const itemName = d.name;
        outboundItemName = itemName;

        const movType = outToProduction ? "out_to_production" : "out";
        let productionTitle: string | null = null;
        let prodRef: ReturnType<typeof doc> | null = null;
        let nextMaterials: unknown[] | null = null;

        if (outToProduction && outProductionId) {
          prodRef = doc(
            firestore,
            "companies",
            companyId,
            "production",
            outProductionId
          );
          const pSnap = await tx.get(prodRef);
          if (!pSnap.exists()) {
            throw new Error("Načtení výroby: záznam nenalezen nebo byl smazán.");
          }
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
            addedBy: user.uid,
          });
          nextMaterials = materials;
        }

        tx.update(itemRef, {
          quantity: prev - qty,
          updatedAt: serverTimestamp(),
        });

        if (prodRef && nextMaterials != null) {
          tx.update(prodRef, {
            materials: nextMaterials,
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
      if (outboundMovementId) {
        void sendModuleEmailNotificationFromBrowser({
          companyId,
          module: "warehouse",
          eventKey: "stockOut",
          entityId: outboundMovementId,
          title: "Vyskladnění",
          lines: [
            `Položka: ${outboundItemName || "—"}`,
            `Množství: ${qty}`,
            outToProduction ? "Pohyb do výroby" : "",
          ].filter(Boolean),
          actionPath: "/portal/sklad",
        });
      }
      toast({ title: "Vyskladněno", description: "Pohyb byl zaznamenán." });
      setOutOpen(false);
      resetOut();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error("[sklad vyskladnění]", raw, e);
      let description = raw;
      if (raw.includes("all reads to be executed before all writes")) {
        description =
          "Chyba synchronizace zápisu (transakce). Zkuste uložit znovu; pokud problém přetrvá, dejte vědět podpoře.";
      } else if (raw.includes("Načtení skladu:") || raw.includes("Načtení výroby:")) {
        description = raw;
      }
      toast({
        variant: "destructive",
        title: "Vyskladnění se nezdařilo",
        description,
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmSoftDelete = async () => {
    if (!deleteTarget || !user || !firestore || !companyId) return;
    setDeleteBusy(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "inventoryItems", deleteTarget.id), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        deletedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: "Položka odstraněna",
        description: "Skladová položka byla skryta z přehledu. Historie pohybů zůstává zachována.",
      });
      setDeleteTarget(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Odstranění se nezdařilo.",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">Sklad</h1>
          <p className="portal-page-description text-slate-700 mt-1">
            Přehled položek, hodnota skladu, naskladnění, vyskladnění a historie pohybů.
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
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-slate-300 bg-white text-slate-900"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" /> Import PDF / CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className={CARD}>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Položek celkem</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {warehouseStats.itemCount}
            </p>
          </CardContent>
        </Card>
        <Card className={CARD}>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Celkové množství (součet ks apod.)</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {Math.round(warehouseStats.totalQty * 100) / 100}
            </p>
          </CardContent>
        </Card>
        <Card className={CARD}>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Celková hodnota skladu</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {formatInventoryMoneyCzk(warehouseStats.totalValue)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Součet množství × cena za jednotku (bez ceny = 0 Kč), jen aktivní položky.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg text-slate-900">Skladové položky</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="bg-white border-slate-200 pl-8 h-9 text-sm"
                  placeholder="Hledat název nebo SKU…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="bg-white border-slate-200 h-9 w-full sm:w-[240px]">
                  <SelectValue placeholder="Kategorie" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="__all__">Všechny kategorie</SelectItem>
                  <SelectItem value="__none__">Bez kategorie</SelectItem>
                  {stockCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canManageInventory ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 border-slate-300 bg-white text-slate-900"
                  onClick={() => setCatManageOpen(true)}
                >
                  Správa kategorií
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 p-0 sm:p-0">
          {itemsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : activeItemList.length === 0 ? (
            <p className="text-sm text-slate-600 px-6 py-8">
              Zatím žádné aktivní položky — použijte Naskladnit nebo import.
            </p>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-slate-600 px-6 py-8">Žádná položka neodpovídá filtru.</p>
          ) : (
            <div className="rounded-b-lg border-t border-slate-100 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="w-14 text-slate-700">Foto</TableHead>
                    <TableHead className="text-slate-700 min-w-[140px]">Název</TableHead>
                    <TableHead className="text-slate-700">SKU</TableHead>
                    <TableHead className="text-slate-700 min-w-[140px]">Kategorie</TableHead>
                    <TableHead className="text-right text-slate-700">Množství</TableHead>
                    <TableHead className="text-slate-700">MJ</TableHead>
                    <TableHead className="text-right text-slate-700">Cena / MJ</TableHead>
                    <TableHead className="text-right text-slate-700">Hodnota</TableHead>
                    {canManageInventory ? (
                      <TableHead className="text-right w-[120px] text-slate-700">Akce</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((row) => {
                    const lineVal = inventoryLineValueCzk(row);
                    const unitP =
                      row.unitPrice != null && Number.isFinite(Number(row.unitPrice))
                        ? Number(row.unitPrice)
                        : null;
                    return (
                      <TableRow key={row.id} className="border-slate-100">
                        <TableCell className="align-middle">
                          <button
                            type="button"
                            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-slate-400 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            onClick={() => {
                              if (row.imageUrl) {
                                setImagePreviewSrc(row.imageUrl);
                                setImagePreviewOpen(true);
                              }
                            }}
                            disabled={!row.imageUrl}
                            aria-label={row.imageUrl ? "Zvětšit obrázek" : "Bez obrázku"}
                          >
                            {row.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.imageUrl}
                                alt=""
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <ImageIcon className="h-5 w-5" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium text-slate-900 align-middle">
                          {row.name}
                        </TableCell>
                        <TableCell className="text-slate-600 align-middle">
                          {row.sku?.trim() ? row.sku : "—"}
                        </TableCell>
                        <TableCell className="text-slate-600 align-middle">
                          {String(
                            row.categoryName ??
                              (row.categoryId ? stockCategoryById.get(String(row.categoryId)) : "") ??
                              ""
                          ).trim() || "Bez kategorie"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-middle">
                          {Number(row.quantity ?? 0)}
                        </TableCell>
                        <TableCell className="text-slate-600 align-middle">
                          {row.unit || "ks"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-middle">
                          {unitP != null ? `${unitP.toLocaleString("cs-CZ")} Kč` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-slate-900 align-middle">
                          {formatInventoryMoneyCzk(lineVal)}
                        </TableCell>
                        {canManageInventory ? (
                          <TableCell className="text-right align-middle">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-slate-700"
                                onClick={() => {
                                  setEditItem(row);
                                  setEditOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                Upravit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-red-700 hover:text-red-800 hover:bg-red-50"
                                onClick={() => setDeleteTarget(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Smazat
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg text-slate-900">Dodací listy přiřazené ke skladu</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {Array.isArray(deliveryNotes) && deliveryNotes.length > 0 ? (
            <div className="space-y-2">
              {deliveryNotes.map((row) => {
                const d = row as {
                  id: string;
                  number?: string;
                  documentNumber?: string;
                  supplier?: string;
                  date?: string;
                  fileUrl?: string | null;
                };
                const label = String(d.number ?? d.documentNumber ?? d.id);
                return (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2"
                  >
                    <div className="text-sm text-slate-800">
                      <strong>{label}</strong>
                      {d.supplier ? ` · ${d.supplier}` : ""}
                      {d.date ? ` · ${d.date}` : ""}
                    </div>
                    {d.fileUrl ? (
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-700 underline"
                      >
                        Otevřít
                      </a>
                    ) : (
                      <span className="text-sm text-slate-500">Bez přílohy</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Zatím nejsou žádné dodací listy přiřazené ke skladu.
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Tato sekce je připravená pro budoucí naskladnění položek z dodacích listů.
          </p>
        </CardContent>
      </Card>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100 flex flex-row items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg text-slate-900">Historie pohybů</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-0 p-0 sm:p-0">
          {movLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : movList.length === 0 ? (
            <p className="text-sm text-slate-600 px-6 py-8">Zatím žádné pohyby.</p>
          ) : (
            <div className="overflow-x-auto rounded-b-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-700">Datum</TableHead>
                    <TableHead className="text-slate-700">Typ</TableHead>
                    <TableHead className="text-slate-700 min-w-[140px]">Položka</TableHead>
                    <TableHead className="text-right text-slate-700">Množství</TableHead>
                    <TableHead className="text-slate-700">Uživatel</TableHead>
                    <TableHead className="text-slate-700 min-w-[180px]">Poznámka / detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movList.map((m) => (
                    <TableRow key={m.id} className="border-slate-100 align-top">
                      <TableCell className="text-slate-700 whitespace-nowrap">{m.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {movementLabel(m.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">{m.itemName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.type === "item_edit" ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <>
                            {m.quantity} {m.unit}
                            {m.adjustmentDelta != null && m.adjustmentDelta !== 0 ? (
                              <span className="block text-xs text-slate-500">
                                Δ {m.adjustmentDelta > 0 ? "+" : ""}
                                {m.adjustmentDelta}
                              </span>
                            ) : null}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs font-mono">
                        {formatMovementUser(m.createdBy)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {m.note ? <p>{m.note}</p> : null}
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
                              <Factory className="h-3 w-3" /> Výroba:{" "}
                              {m.productionTitle || m.productionId}
                            </Link>
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
                    {activeItemList.map((i) => (
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

      {user && firestore && companyId ? (
        <WarehouseImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          firestore={firestore}
          companyId={companyId}
          userId={user.uid}
          items={activeItemList}
        />
      ) : null}

      {user && firestore && companyId ? (
        <InventoryItemEditDialog
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o);
            if (!o) setEditItem(null);
          }}
          firestore={firestore}
          companyId={companyId}
          userId={user.uid}
          item={editItem}
          onSaved={() => {}}
          stockCategories={stockCategories}
        />
      ) : null}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-white border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Odstranit položku ze skladu?</AlertDialogTitle>
            <AlertDialogDescription>
              Položka „{deleteTarget?.name ?? ""}“ bude skryta z přehledu (měkké smazání). Historie pohybů
              zůstane zachována. Operaci nelze z portálu vrátit jedním kliknutím — kontaktujte správce, pokud
              potřebujete obnovit záznam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300">Zrušit</AlertDialogCancel>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteBusy}
              onClick={() => void confirmSoftDelete()}
            >
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Odstranit"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={imagePreviewOpen}
        onOpenChange={(o) => {
          setImagePreviewOpen(o);
          if (!o) setImagePreviewSrc(null);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Náhled obrázku</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-2">
            {imagePreviewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePreviewSrc} alt="" className="max-h-[65vh] max-w-full object-contain" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={catManageOpen} onOpenChange={setCatManageOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-xl" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Kategorie skladu</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label>Nová kategorie</Label>
                <Input
                  className="bg-white"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Např. Pergoly"
                />
              </div>
              <Button type="button" disabled={catBusy} onClick={() => void createCategory()}>
                {catBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vytvořit"}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={catBusy}
                className="border-slate-300 bg-white text-slate-900"
                onClick={() => void seedDefaults()}
              >
                Vytvořit výchozí kategorie
              </Button>
              <p className="text-xs text-slate-500 self-center">
                Výchozí: pergoly, zasklení, příslušenství, materiál, spojovací materiál, ostatní.
              </p>
            </div>

            <div className="space-y-2">
              {stockCategories.length === 0 ? (
                <p className="text-sm text-slate-600">Zatím žádné kategorie.</p>
              ) : (
                stockCategories.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-col gap-2 rounded border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <Input
                        className="bg-white"
                        defaultValue={c.name}
                        onBlur={(e) => {
                          const next = e.target.value;
                          if (next.trim() && next.trim() !== c.name.trim()) {
                            void renameCategory(c.id, next);
                          }
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-slate-600">Pořadí</Label>
                        <Input
                          className="h-8 w-24 bg-white text-sm"
                          defaultValue={String(c.order)}
                          inputMode="numeric"
                          onBlur={(e) => {
                            const n = Number(String(e.target.value).replace(",", "."));
                            if (Number.isFinite(n) && n !== c.order) {
                              void updateCategoryOrder(c.id, n);
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-slate-300 bg-white text-slate-900"
                        disabled={catBusy}
                        onClick={() => void deleteCategory(c.id)}
                      >
                        Smazat
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatManageOpen(false)} className="border-slate-300">
              Zavřít
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
                  {activeItemList.map((i) => (
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
