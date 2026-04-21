"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { ArrowLeft, Factory, Loader2, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import type { InventoryItemRow } from "@/lib/inventory-types";
import Image from "next/image";

const CARD = "border-slate-200 bg-white text-slate-900";

type SafeJobView = Record<string, unknown> & { jobId?: string };

export default function VyrobaZakazkaDetailPage() {
  const params = useParams();
  const jobIdRaw = params?.jobId;
  const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { company, companyId } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
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
    canAccessCompanyModule(company, "vyroba", platformCatalog) &&
    userCanAccessProductionPortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
    });

  const foldersCol = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", String(jobId), "folders")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection(foldersCol);

  const invCol = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(collection(firestore, "companies", companyId, "inventoryItems"), limit(500))
        : null,
    [firestore, companyId]
  );
  const { data: inventoryRaw } = useCollection(invCol);
  const inventoryItems = useMemo(() => {
    const list = Array.isArray(inventoryRaw) ? inventoryRaw : [];
    return list
      .filter(
        (r): r is InventoryItemRow =>
          !!r &&
          typeof (r as { id?: string }).id === "string" &&
          (r as { isDeleted?: boolean }).isDeleted !== true
      )
      .sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), "cs")
      );
  }, [inventoryRaw]);

  const [jobView, setJobView] = useState<SafeJobView | null>(null);
  const [visibleFolderPick, setVisibleFolderPick] = useState<Set<string>>(new Set());
  const [consumptions, setConsumptions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [issueItemId, setIssueItemId] = useState<string>("");
  const [issueQty, setIssueQty] = useState<string>("");
  const [issueNote, setIssueNote] = useState<string>("");
  const [issueBatch, setIssueBatch] = useState<string>("");
  const [issueSaving, setIssueSaving] = useState(false);

  const loadApi = useCallback(async () => {
    if (!user || !jobId) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const [vRes, cRes] = await Promise.all([
        fetch(`/api/company/production/job-view?jobId=${encodeURIComponent(String(jobId))}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
        fetch(`/api/company/production/material-consumptions?jobId=${encodeURIComponent(String(jobId))}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      ]);
      const vJson = await vRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      if (!vRes.ok) {
        throw new Error(typeof vJson.error === "string" ? vJson.error : "Zakázku nelze zobrazit.");
      }
      if (!cRes.ok) {
        throw new Error(typeof cJson.error === "string" ? cJson.error : "Historii nelze načíst.");
      }
      setJobView((vJson.job as SafeJobView) || null);
      const folderIdsRaw = (vJson.settings as { productionVisibleFolderIds?: unknown } | null | undefined)
        ?.productionVisibleFolderIds;
      const folderIds = Array.isArray(folderIdsRaw)
        ? folderIdsRaw.map((x) => String(x)).filter(Boolean)
        : [];
      setVisibleFolderPick(new Set(folderIds));
      setConsumptions(Array.isArray(cJson.consumptions) ? cJson.consumptions : []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
      });
      setJobView(null);
      setVisibleFolderPick(new Set());
    } finally {
      setLoading(false);
    }
  }, [user, jobId, toast]);

  useEffect(() => {
    if (accessOk && user && jobId) void loadApi();
  }, [accessOk, user, jobId, loadApi]);

  /**
   * Firestore pravidla by ideálně vracela jen složky, které smí výrobní tým vidět.
   * Pro jistotu ale filtrujeme i na klientu podle `productionVisibleFolderIds` / `productionTeamVisible`.
   */
  const visibleFolders = useMemo(() => {
    const list = Array.isArray(foldersRaw) ? foldersRaw : [];
    return list
      .filter(
        (f): f is { id: string; name?: string; type?: string; productionTeamVisible?: boolean } =>
          !!f && typeof (f as { id?: string }).id === "string"
      )
      .filter((f) => f.type !== "documents")
      .filter((f) => {
        if (visibleFolderPick.size > 0) return visibleFolderPick.has(f.id);
        return f.productionTeamVisible === true;
      })
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "cs"));
  }, [foldersRaw, visibleFolderPick]);

  const selectedItem = useMemo(
    () => inventoryItems.find((i) => i.id === issueItemId) ?? null,
    [inventoryItems, issueItemId]
  );

  const availableQty = useMemo(() => {
    if (!selectedItem) return 0;
    const mode = String(selectedItem.stockTrackingMode || "pieces");
    if (mode === "length") {
      const cur = selectedItem.currentLength;
      if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
    }
    return Number(selectedItem.quantity ?? 0);
  }, [selectedItem]);

  const remainderPreview = useMemo(() => {
    const q = Number(String(issueQty).replace(",", "."));
    if (!selectedItem || !Number.isFinite(q) || q <= 0) return null;
    return Math.max(0, availableQty - q);
  }, [selectedItem, issueQty, availableQty]);

  const submitIssue = async () => {
    if (!user || !jobId) return;
    const qty = Number(String(issueQty).replace(",", "."));
    if (!issueItemId || !Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Vyberte položku a množství." });
      return;
    }
    if (qty > availableQty + 1e-9) {
      toast({ variant: "destructive", title: "Nelze vydat více než je skladem." });
      return;
    }
    setIssueSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/issue-material", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          jobId: String(jobId),
          itemId: issueItemId,
          quantity: qty,
          note: issueNote.trim() || null,
          batchNumber: issueBatch.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Výdej se nezdařil.");
      }
      toast({ title: "Materiál vydán", description: "Zápis byl uložen na zakázku a do skladu." });
      setIssueQty("");
      setIssueNote("");
      setIssueBatch("");
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Výdej se nezdařil.",
      });
    } finally {
      setIssueSaving(false);
    }
  };

  if (!user || !companyId || !jobId) {
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
          Nemáte přístup.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/portal/vyroba/zakazky" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Zakázky ve výrobě
          </Link>
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/portal/vyroba">Výroba</Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !jobView ? (
        <Card className={CARD}>
          <CardContent className="py-10 text-center">Zakázka není k dispozici.</CardContent>
        </Card>
      ) : (
        <>
          <div>
            <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">
              {String(jobView.displayLabel || jobView.name || jobId)}
            </h1>
            <div className="flex flex-wrap gap-2 mt-2">
              {jobView.status ? (
                <Badge variant="outline" className="capitalize">
                  {String(jobView.status)}
                </Badge>
              ) : null}
            </div>
            <p className="portal-page-description text-slate-700 mt-2 text-sm">
              Zobrazení bez cen, faktur a obchodních dokladů.
            </p>
          </div>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900">Údaje pro práci</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm text-slate-800">
              {jobView.productionStatusNote ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Stav výroby</p>
                  <p>{String(jobView.productionStatusNote)}</p>
                </div>
              ) : null}
              {jobView.description ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Popis</p>
                  <p className="whitespace-pre-wrap">{String(jobView.description)}</p>
                </div>
              ) : null}
              {jobView.measuring || jobView.measuringDetails ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Měření / technické</p>
                  <p className="whitespace-pre-wrap">{String(jobView.measuring || "")}</p>
                  {jobView.measuringDetails ? (
                    <p className="whitespace-pre-wrap mt-1 text-slate-700">
                      {String(jobView.measuringDetails)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {jobView.productionTeamNotes ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Výrobní poznámky</p>
                  <p className="whitespace-pre-wrap">{String(jobView.productionTeamNotes)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Factory className="h-4 w-4" />
                Fotodokumentace a podklady
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {visibleFolders.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Žádné složky označené pro výrobu. Požádejte administrátora o přiřazení složek nebo přepínač
                  u složky zakázky.
                </p>
              ) : (
                visibleFolders.map((folder) => (
                  <ProductionFolderStrip
                    key={folder.id}
                    companyId={companyId}
                    jobId={String(jobId)}
                    folderId={folder.id}
                    folderName={folder.name || folder.id}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Vzít materiál ze skladu
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm">
              <div className="space-y-2">
                <Label>Skladová položka</Label>
                <Select value={issueItemId || undefined} onValueChange={setIssueItemId}>
                  <SelectTrigger className="bg-white border-slate-200">
                    <SelectValue placeholder="Vyberte materiál" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 max-h-60">
                    {inventoryItems.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({i.unit || "ks"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedItem ? (
                <p className="text-xs text-slate-600">
                  Dostupné:{" "}
                  <strong>
                    {availableQty} {selectedItem.unit || "ks"}
                  </strong>
                  {String(selectedItem.stockTrackingMode || "") === "length"
                    ? " (délková evidence — lze odebrat jen část, zbytek zůstane na skladě)"
                    : null}
                </p>
              ) : null}
              <div className="space-y-2">
                <Label>Odebrané množství</Label>
                <Input
                  className="bg-white border-slate-200"
                  inputMode="decimal"
                  value={issueQty}
                  onChange={(e) => setIssueQty(e.target.value)}
                  placeholder={selectedItem ? `max ${availableQty}` : ""}
                />
                {remainderPreview != null && selectedItem ? (
                  <p className="text-xs text-slate-600">
                    Po výdeji zbude na skladě: <strong>{remainderPreview}</strong> {selectedItem.unit || ""}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Šarže / poznámka (volitelné)</Label>
                <Input
                  className="bg-white border-slate-200"
                  value={issueBatch}
                  onChange={(e) => setIssueBatch(e.target.value)}
                  placeholder="Šarže"
                />
                <Textarea
                  className="bg-white border-slate-200 min-h-[64px]"
                  value={issueNote}
                  onChange={(e) => setIssueNote(e.target.value)}
                  placeholder="Poznámka k výdeji"
                />
              </div>
              <Button type="button" disabled={issueSaving} onClick={() => void submitIssue()}>
                {issueSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdit výdej na zakázku"}
              </Button>
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900">Historie spotřeby materiálu</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2 text-sm">
              {consumptions.length === 0 ? (
                <p className="text-slate-600">Zatím žádné výdeje.</p>
              ) : (
                consumptions.map((c) => (
                  <div
                    key={String(c.id ?? Math.random())}
                    className="rounded border border-slate-100 p-3 text-slate-800"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{String(c.itemName ?? "")}</span>
                      <span>
                        {String(c.quantity ?? "")} {String(c.unit ?? "")}
                      </span>
                    </div>
                    {c.quantityRemainingOnStock != null ? (
                      <p className="text-xs text-slate-500 mt-1">
                        Zůstatek na skladě po pohybu: {String(c.quantityRemainingOnStock)} {String(c.unit ?? "")}
                      </p>
                    ) : null}
                    {c.note ? <p className="text-xs mt-1">{String(c.note)}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ProductionFolderStrip({
  companyId,
  jobId,
  folderId,
  folderName,
}: {
  companyId: string;
  jobId: string;
  folderId: string;
  folderName: string;
}) {
  const firestore = useFirestore();
  const imgCol = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(
              firestore,
              "companies",
              companyId,
              "jobs",
              jobId,
              "folders",
              folderId,
              "images"
            ),
            orderBy("createdAt", "desc"),
            limit(24)
          )
        : null,
    [firestore, companyId, jobId, folderId]
  );
  const { data: images, isLoading } = useCollection(imgCol);

  return (
    <div>
      <p className="text-sm font-semibold text-slate-900 mb-2">{folderName}</p>
      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      ) : !images || images.length === 0 ? (
        <p className="text-xs text-slate-500">Žádné soubory.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {images.map((im) => {
            const url = String((im as { fileUrl?: string }).fileUrl || "");
            const name = String((im as { fileName?: string }).fileName || "soubor");
            if (!url) return null;
            const isImg = /\.(jpe?g|png|gif|webp)$/i.test(name) || url.includes("image");
            return (
              <a
                key={(im as { id?: string }).id || url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-24 h-24 rounded border border-slate-200 overflow-hidden bg-slate-50"
              >
                {isImg ? (
                  <Image src={url} alt={name} width={96} height={96} className="object-cover w-full h-full" unoptimized />
                ) : (
                  <span className="text-[10px] p-1 block truncate">{name}</span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
