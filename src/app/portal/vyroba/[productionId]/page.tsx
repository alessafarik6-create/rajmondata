"use client";

import React, { useMemo, useState } from "react";
import type { InventoryItemRow } from "@/lib/inventory-types";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  addDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import {
  useUser,
  useFirebase,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import {
  PRODUCTION_STATUS_LABELS,
  type ProductionRecordRow,
  type ProductionStatus,
} from "@/lib/production-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildProductionAttachmentStorageObjectPath } from "@/lib/job-photo-upload";
import { getJobMediaFileTypeFromFile } from "@/lib/job-media-types";
import { InventoryItemThumbnail } from "@/components/warehouse/inventory-item-thumbnail";

const CARD = "border-slate-200 bg-white text-slate-900";

const STATUSES: ProductionStatus[] = ["new", "ready", "in_progress", "done"];

export default function VyrobaDetailPage() {
  const params = useParams();
  const productionId = String(params?.productionId || "");
  const router = useRouter();
  const { user } = useUser();
  const { firestore, areServicesAvailable } = useFirebase();
  const { toast } = useToast();
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
    canAccessCompanyModule(company, "vyroba", platformCatalog) &&
    userCanAccessProductionPortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
    });

  const prodRef = useMemoFirebase(
    () =>
      firestore && companyId && productionId
        ? doc(firestore, "companies", companyId, "production", productionId)
        : null,
    [firestore, companyId, productionId]
  );
  const { data: prod, isLoading: prodLoading } = useDoc<ProductionRecordRow>(prodRef);

  const attQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId || !productionId) return null;
    return query(
      collection(firestore, "companies", companyId, "production", productionId, "attachments"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
  }, [areServicesAvailable, firestore, companyId, productionId]);

  const { data: attachments, isLoading: attLoading } = useCollection(attQuery);

  const invCol = useMemoFirebase(
    () =>
      areServicesAvailable && firestore && companyId
        ? query(collection(firestore, "companies", companyId, "inventoryItems"), limit(2500))
        : null,
    [areServicesAvailable, firestore, companyId]
  );
  const { data: inventoryRaw } = useCollection(invCol);
  const inventoryById = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    const list = Array.isArray(inventoryRaw) ? inventoryRaw : [];
    for (const r of list) {
      if (!r || typeof (r as { id?: unknown }).id !== "string") continue;
      const row = r as InventoryItemRow;
      if (row.isDeleted === true) continue;
      m.set(row.id, row);
    }
    return m;
  }, [inventoryRaw]);

  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const materials = useMemo(() => {
    if (!prod || !Array.isArray(prod.materials)) return [];
    return prod.materials;
  }, [prod]);

  React.useEffect(() => {
    if (typeof prod?.note === "string") setNoteDraft(prod.note);
    else setNoteDraft("");
  }, [prod?.note, prod?.id]);

  if (!user || !areServicesAvailable || !companyId || !productionId) {
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
          Nemáte přístup k výrobě.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (prodLoading || !prodRef) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!prod) {
    return (
      <Card className={CARD}>
        <CardContent className="py-10 text-center">Záznam nenalezen.</CardContent>
      </Card>
    );
  }

  const saveNote = async () => {
    setSaving(true);
    try {
      await updateDoc(prodRef, {
        note: noteDraft.trim(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Poznámka uložena" });
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

  const setStatus = async (status: ProductionStatus) => {
    setSaving(true);
    try {
      await updateDoc(prodRef, {
        status,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Stav uložen" });
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

  const onUploadFile = async (file: File | null) => {
    if (!file || !user || !areServicesAvailable || !firestore) return;
    setUploading(true);
    try {
      const storage = getFirebaseStorage();
      const path = buildProductionAttachmentStorageObjectPath(
        companyId,
        productionId,
        file.name
      );
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type || "application/octet-stream" });
      const fileUrl = await getDownloadURL(storageRef);
      const fileType = getJobMediaFileTypeFromFile(file);
      const safeName = file.name.replace(/^.*[\\/]/, "").trim() || "soubor";
      await addDoc(
        collection(
          firestore,
          "companies",
          companyId,
          "production",
          productionId,
          "attachments"
        ),
        {
          companyId,
          productionId,
          fileUrl,
          fileName: safeName,
          fileType,
          mimeType: file.type || null,
          storagePath: path,
          note: null,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        }
      );
      toast({ title: "Soubor nahrán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nahrání selhalo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/portal/vyroba">
            <ArrowLeft className="h-4 w-4" /> Seznam výrob
          </Link>
        </Button>
      </div>

      {prod.jobId ? (
        <Card className="border-amber-300 bg-amber-50/90 text-slate-900">
          <CardContent className="py-4 text-sm space-y-2">
            <p className="font-medium">Skutečná výroba u zakázky (materiál, řezy, zbytky, podklady)</p>
            <p className="text-slate-700">
              Tato stránka je interní záznam výroby. Pro výdej ze skladu, metráž, zbytky a velké náhledy souborů
              použijte výrobní dílnu u zakázky.
            </p>
            <Button type="button" size="sm" variant="default" asChild>
              <Link href={`/portal/vyroba/zakazky/${String(prod.jobId)}`}>Otevřít výrobní dílnu zakázky</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div>
        <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">
          {prod.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{PRODUCTION_STATUS_LABELS[prod.status] || prod.status}</Badge>
          {prod.jobName || prod.jobId ? (
            <span className="text-sm text-slate-700">
              Zakázka:{" "}
              {prod.jobId ? (
                <Link href={`/portal/jobs/${prod.jobId}`} className="text-primary underline">
                  {prod.jobName || prod.jobId}
                </Link>
              ) : (
                prod.jobName
              )}
            </span>
          ) : (
            <span className="text-sm text-slate-500">Bez zakázky</span>
          )}
        </div>
      </div>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base text-slate-900">Stav výroby</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Select
            value={prod.status}
            onValueChange={(v) => void setStatus(v as ProductionStatus)}
            disabled={saving}
          >
            <SelectTrigger className="bg-white border-slate-200 max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PRODUCTION_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base text-slate-900">Poznámka</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Textarea
            className="bg-white border-slate-200 text-slate-900 min-h-[100px]"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <Button type="button" disabled={saving} onClick={() => void saveNote()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit poznámku"}
          </Button>
        </CardContent>
      </Card>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base text-slate-900">Materiál ze skladu</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2">
          {materials.length === 0 ? (
            <p className="text-sm text-slate-600">
              Zatím žádný materiál — přidejte ho vyskladněním se zapnutou volbou „Do výroby“ v modulu
              Sklad.
            </p>
          ) : (
            materials.map((m: any, idx: number) => {
              const when =
                typeof m.addedAt === "string" && m.addedAt.trim()
                  ? (() => {
                      const d = new Date(m.addedAt);
                      return Number.isNaN(d.getTime())
                        ? m.addedAt
                        : d.toLocaleString("cs-CZ");
                    })()
                  : null;
              const by =
                typeof m.addedBy === "string" && m.addedBy.trim()
                  ? m.addedBy.trim()
                  : null;
              const inv = typeof m.itemId === "string" && m.itemId.trim() ? inventoryById.get(m.itemId.trim()) : undefined;
              return (
                <div
                  key={`${m.movementId || idx}-${m.itemId}`}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-sm sm:flex-row sm:items-start"
                >
                  <div className="flex justify-center sm:block">
                    <InventoryItemThumbnail
                      item={inv}
                      size={120}
                      enableLightbox
                      lightboxTitle={String(m.itemName ?? "Skladová položka")}
                      className="sm:shrink-0"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      {m.itemName}
                    </span>
                    <span className="mt-1 block text-slate-700">
                      Množství: <strong>{m.quantity}</strong> {m.unit}
                    </span>
                  {m.itemId ? (
                    <span className="text-xs text-slate-500 block mt-1">
                      Skladová položka (ID): {m.itemId}
                    </span>
                  ) : null}
                  {when ? (
                    <span className="text-xs text-slate-500 block mt-0.5">Vyskladněno: {when}</span>
                  ) : null}
                  {by ? (
                    <span className="text-xs text-slate-500 block mt-0.5">
                      Uživatel (uid): {by}
                    </span>
                  ) : null}
                  {m.movementId ? (
                    <span className="text-xs text-slate-500 block mt-0.5">
                      Pohyb skladu: {m.movementId}
                    </span>
                  ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base text-slate-900">Podklady (soubory)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <Label className="mb-2 block">Nahrát soubor (PDF, foto, dokument)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="gap-2 relative" disabled={uploading}>
                <Upload className="h-4 w-4" />
                {uploading ? "Nahrávám…" : "Vybrat soubor"}
                <input
                  type="file"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  accept="image/*,application/pdf,.doc,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    void onUploadFile(f || null);
                  }}
                />
              </Button>
            </div>
          </div>
          {attLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : !attachments || attachments.length === 0 ? (
            <p className="text-sm text-slate-600">Žádné přílohy.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(attachments as any[]).map((a) => (
                <li key={a.id}>
                  <a
                    href={a.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {a.fileName || "soubor"}
                  </a>
                  <span className="text-slate-500 text-xs ml-2">{a.fileType}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
