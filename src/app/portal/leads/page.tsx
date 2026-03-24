"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Inbox,
  RefreshCw,
  Search,
  Ruler,
  Tags,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
} from "@/firebase";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { buildMeasurementPrefillHref } from "@/lib/measurement-prefill-from-lead";
import { userCanManageMeasurements } from "@/lib/measurements";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";

const POLL_MS = 5 * 60 * 1000;

type LeadTagRow = {
  id?: string;
  name?: string;
  sortOrder?: number;
  companyId?: string;
};

type LeadOverlayRow = {
  id?: string;
  companyId?: string;
  importLeadId?: string;
  tagId?: string | null;
};

type ApiImportBody = {
  ok?: boolean;
  rows?: LeadImportRow[];
  warning?: string;
  error?: string;
  code?: string;
  importUrlDebug?: string;
};

function leadSearchBlob(r: LeadImportRow): string {
  return [
    r.jmeno,
    r.telefon,
    r.email,
    r.adresa,
    r.zprava,
    r.typ,
    r.id,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
}

export default function PortalLeadsPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const role = (profile?.role as string | undefined) ?? "employee";
  const isCustomer = role === "customer";

  const tagsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "lead_tags");
  }, [firestore, companyId]);

  const overlaysQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "import_lead_overlays");
  }, [firestore, companyId]);

  const { data: tagsRaw, isLoading: tagsLoading } = useCollection(tagsQuery);
  const { data: overlaysRaw } = useCollection(overlaysQuery);

  const tags = useMemo(() => {
    const list = Array.isArray(tagsRaw) ? (tagsRaw as LeadTagRow[]) : [];
    return [...list]
      .filter((t) => t?.id)
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  }, [tagsRaw]);

  const overlayByDocId = useMemo(() => {
    const m = new Map<string, LeadOverlayRow>();
    const list = Array.isArray(overlaysRaw) ? overlaysRaw : [];
    for (const d of list) {
      const row = d as LeadOverlayRow & { id?: string };
      if (row.id) m.set(row.id, row);
    }
    return m;
  }, [overlaysRaw]);

  const [rows, setRows] = useState<LeadImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorDebugUrl, setErrorDebugUrl] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterTyp, setFilterTyp] = useState<string>("");
  const [filterTag, setFilterTag] = useState<string>("");

  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [editingTag, setEditingTag] = useState<{ id: string; name: string } | null>(null);
  const [savingTag, setSavingTag] = useState(false);

  const loadLeads = useCallback(async () => {
    const cid = (companyId ?? "").trim();
    if (!cid || !user) return;
    setLoading(true);
    setError(null);
    setErrorDebugUrl(null);
    setWarning(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/import-leads?companyId=${encodeURIComponent(cid)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      let data: ApiImportBody | null = null;
      try {
        data = (await res.json()) as ApiImportBody;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const dbg =
          typeof data?.importUrlDebug === "string" && data.importUrlDebug.trim()
            ? data.importUrlDebug.trim()
            : null;
        setErrorDebugUrl(dbg);
        setError(data?.error || `Import selhal (HTTP ${res.status}).`);
        setRows([]);
        return;
      }
      if (data?.ok === true && Array.isArray(data.rows)) {
        setRows(data.rows);
        setWarning(
          typeof data.warning === "string" && data.warning.trim() ? data.warning.trim() : null
        );
        return;
      }
      setError("Neplatná odpověď serveru.");
      setRows([]);
    } catch {
      setError("Nelze načíst poptávky.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, user]);

  useEffect(() => {
    if (!companyId || isUserLoading || !user) return;
    void loadLeads();
  }, [companyId, isUserLoading, user, loadLeads]);

  useEffect(() => {
    if (!companyId || !user) return;
    const t = window.setInterval(() => void loadLeads(), POLL_MS);
    return () => window.clearInterval(t);
  }, [companyId, user, loadLeads]);

  const typOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const t = String(r.typ ?? "").trim();
      if (t) s.add(t);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "cs"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => leadSearchBlob(r).includes(q));
    }
    if (filterTyp) {
      list = list.filter((r) => String(r.typ ?? "").trim() === filterTyp);
    }
    if (filterTag === "__none__") {
      list = list.filter((r) => {
        const key = stableImportLeadDocumentId(r);
        const o = overlayByDocId.get(key);
        return !o?.tagId;
      });
    } else if (filterTag) {
      list = list.filter((r) => {
        const key = stableImportLeadDocumentId(r);
        const o = overlayByDocId.get(key);
        return o?.tagId === filterTag;
      });
    }
    return list;
  }, [rows, search, filterTyp, filterTag, overlayByDocId]);

  const canMeasure = userCanManageMeasurements(profile);
  const canManageTags =
    role === "owner" || role === "admin" || role === "manager" || role === "accountant";

  const handleTagChange = async (lead: LeadImportRow, tagId: string | null) => {
    if (!firestore || !companyId || !user) return;
    const key = stableImportLeadDocumentId(lead);
    const ref = doc(firestore, "companies", companyId, "import_lead_overlays", key);
    try {
      await setDoc(
        ref,
        {
          companyId,
          importLeadId: lead.id,
          tagId,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení štítku",
        description: "Stav se nepodařilo uložit.",
      });
    }
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!firestore || !companyId || !user || !name) return;
    setSavingTag(true);
    try {
      await addDoc(collection(firestore, "companies", companyId, "lead_tags"), {
        companyId,
        name,
        sortOrder: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewTagName("");
      toast({ title: "Štítek vytvořen" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Nepodařilo se vytvořit štítek." });
    } finally {
      setSavingTag(false);
    }
  };

  const handleRenameTag = async () => {
    if (!editingTag || !firestore || !companyId) return;
    const name = editingTag.name.trim();
    if (!name) return;
    setSavingTag(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "lead_tags", editingTag.id), {
        name,
        updatedAt: serverTimestamp(),
      });
      setEditingTag(null);
      toast({ title: "Štítek uložen" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Úprava se nezdařila." });
    } finally {
      setSavingTag(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!firestore || !companyId) return;
    if (!window.confirm("Opravdu smazat tento štítek? U poptávek zůstane vazba neplatná, dokud nevyberete jiný.")) {
      return;
    }
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "lead_tags", tagId));
      toast({ title: "Štítek smazán" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Smazání se nezdařilo." });
    }
  };

  if (profileLoading || isUserLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isCustomer) {
    return (
      <Alert className="max-w-lg border-slate-200">
        <AlertTitle>Přístup omezen</AlertTitle>
        <AlertDescription>Sekce Poptávky není pro účet zákazníka k dispozici.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>Poptávky nelze načíst bez přiřazení k organizaci.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl flex items-center gap-2">
          <Inbox className="h-7 w-7 text-orange-500 shrink-0" />
          Poptávky
        </h1>
        <p className="portal-page-description mt-1">
          Importované poptávky ze zdroje nastaveného u organizace. Štítky a stav se ukládají v aplikaci a při
          obnově importu se nemažou.
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3 space-y-0">
          <CardTitle className="text-base">Filtry a akce</CardTitle>
          <CardDescription>Vyhledávání v načtených datech, filtr typu ze zdroje a štítku.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label htmlFor="lead-search" className="text-xs text-slate-600">
                Vyhledávání
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="lead-search"
                  className="pl-9"
                  placeholder="Jméno, telefon, e-mail, adresa, typ, zpráva…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="w-full sm:w-[200px] space-y-1.5">
              <Label className="text-xs text-slate-600">Typ poptávky (ze zdroje)</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={filterTyp}
                onChange={(e) => setFilterTyp(e.target.value)}
              >
                <option value="">Všechny typy</option>
                {typOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-[220px] space-y-1.5">
              <Label className="text-xs text-slate-600">Štítek</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
              >
                <option value="">Všechny</option>
                <option value="__none__">Bez štítku</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id!}>
                    {t.name || t.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2 min-h-[44px]"
                onClick={() => void loadLeads()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Obnovit
              </Button>
              {canManageTags ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2 min-h-[44px]"
                  onClick={() => setTagsDialogOpen(true)}
                >
                  <Tags className="h-4 w-4" />
                  Správa štítků
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Automatické obnovení každých 5 minut. Pole „typ“ se bere z importního JSON (např. typ, type,
            kategorie, productType) — záleží na vašem zdroji.
          </p>
        </CardContent>
      </Card>

      <Dialog open={tagsDialogOpen} onOpenChange={setTagsDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white border-slate-200">
          <DialogHeader>
            <DialogTitle>Štítky poptávek</DialogTitle>
            <DialogDescription>
              Vytvářejte vlastní štítky pro firmu. Každou poptávku můžete označit v tabulce níže.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input
                placeholder="Název nového štítku"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleCreateTag()}
              />
              <Button type="button" onClick={() => void handleCreateTag()} disabled={savingTag || !newTagName.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {tagsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <p className="text-sm text-slate-600">Zatím nemáte žádné štítky — vytvořte první výše.</p>
            ) : (
              <ul className="divide-y rounded-md border border-slate-200 max-h-[280px] overflow-y-auto">
                {tags.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium truncate">{t.name || t.id}</span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9"
                        onClick={() => setEditingTag({ id: t.id!, name: t.name || "" })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive"
                        onClick={() => void handleDeleteTag(t.id!)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTagsDialogOpen(false)}>
              Zavřít
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTag} onOpenChange={(o) => !o && setEditingTag(null)}>
        <DialogContent className="sm:max-w-sm bg-white border-slate-200">
          <DialogHeader>
            <DialogTitle>Přejmenovat štítek</DialogTitle>
          </DialogHeader>
          <Input
            value={editingTag?.name ?? ""}
            onChange={(e) => editingTag && setEditingTag({ ...editingTag, name: e.target.value })}
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingTag(null)}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void handleRenameTag()} disabled={savingTag}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-600">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Načítám poptávky…</p>
            </div>
          ) : error ? (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertTitle>Chyba importu</AlertTitle>
                <AlertDescription className="space-y-2 break-words">
                  <span className="block">{error}</span>
                  {errorDebugUrl ? (
                    <span className="block text-xs font-mono opacity-90">Zdroj: {errorDebugUrl}</span>
                  ) : null}
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <>
              {warning ? (
                <Alert className="m-4 border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTitle>Upozornění</AlertTitle>
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              ) : null}
              {rows.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-600">
                  Žádné poptávky nebyly nalezeny.
                </p>
              ) : filteredRows.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-600">
                  Žádné záznamy neodpovídají filtru.
                </p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                          <TableHead className="min-w-[100px]">Typ</TableHead>
                          <TableHead className="min-w-[120px]">Jméno</TableHead>
                          <TableHead className="min-w-[110px]">Telefon</TableHead>
                          <TableHead className="min-w-[160px]">E-mail</TableHead>
                          <TableHead className="min-w-[160px] hidden lg:table-cell">Adresa</TableHead>
                          <TableHead className="min-w-[140px]">Štítek</TableHead>
                          <TableHead className="min-w-[180px] hidden xl:table-cell">Zpráva</TableHead>
                          <TableHead className="w-[120px] text-right">Akce</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((r) => {
                          const key = stableImportLeadDocumentId(r);
                          const ov = overlayByDocId.get(key);
                          const currentTag = ov?.tagId ?? "";
                          return (
                            <TableRow key={`${key}-${r.id}`} className="border-slate-200">
                              <TableCell className="align-top text-sm">
                                {r.typ?.trim() ? (
                                  <Badge variant="secondary" className="font-normal">
                                    {r.typ}
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>
                              <TableCell className="align-top text-sm font-medium text-slate-900">
                                {r.jmeno || "—"}
                              </TableCell>
                              <TableCell className="align-top text-sm tabular-nums">{r.telefon || "—"}</TableCell>
                              <TableCell className="align-top text-sm break-all">{r.email || "—"}</TableCell>
                              <TableCell className="align-top text-sm whitespace-pre-wrap text-slate-700 hidden lg:table-cell max-w-[220px]">
                                {r.adresa || "—"}
                              </TableCell>
                              <TableCell className="align-top min-w-[160px]">
                                <Select
                                  value={currentTag || "__none__"}
                                  onValueChange={(v) =>
                                    void handleTagChange(r, v === "__none__" ? null : v)
                                  }
                                >
                                  <SelectTrigger className="h-9 text-left">
                                    <SelectValue placeholder="Vyberte štítek" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Bez štítku</SelectItem>
                                    {tags.map((t) => (
                                      <SelectItem key={t.id} value={t.id!}>
                                        {t.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {currentTag && !tags.some((x) => x.id === currentTag) ? (
                                  <p className="text-[10px] text-amber-700 mt-1">Štítek byl smazán — vyberte nový.</p>
                                ) : null}
                              </TableCell>
                              <TableCell className="align-top text-sm text-slate-600 hidden xl:table-cell max-w-xs whitespace-pre-wrap">
                                {r.zprava || "—"}
                              </TableCell>
                              <TableCell className="align-top text-right">
                                {canMeasure ? (
                                  <Button
                                    asChild
                                    size="sm"
                                    className="min-h-[40px] bg-orange-500 hover:bg-orange-600 text-white border-0"
                                  >
                                    <Link href={buildMeasurementPrefillHref(r)}>
                                      <Ruler className="w-4 h-4 mr-1 inline" />
                                      Zaměřit
                                    </Link>
                                  </Button>
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden divide-y divide-slate-200">
                    {filteredRows.map((r) => {
                      const key = stableImportLeadDocumentId(r);
                      const ov = overlayByDocId.get(key);
                      const currentTag = ov?.tagId ?? "";
                      return (
                        <div key={`${key}-${r.id}`} className="p-4 space-y-3 bg-white">
                          <div className="flex flex-wrap gap-2 items-center">
                            {r.typ?.trim() ? (
                              <Badge variant="secondary">{r.typ}</Badge>
                            ) : null}
                            {currentTag ? (
                              <Badge variant="outline" className="text-xs">
                                {tags.find((x) => x.id === currentTag)?.name || "Štítek"}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="font-semibold text-slate-900">{r.jmeno || "—"}</p>
                          <p className="text-sm text-slate-700">
                            <span className="text-slate-500">Tel. </span>
                            {r.telefon || "—"}
                          </p>
                          <p className="text-sm break-all">
                            <span className="text-slate-500">E-mail </span>
                            {r.email || "—"}
                          </p>
                          {r.adresa ? (
                            <p className="text-sm whitespace-pre-wrap text-slate-700">{r.adresa}</p>
                          ) : null}
                          {r.zprava ? (
                            <p className="text-sm text-slate-600 whitespace-pre-wrap border-t border-slate-100 pt-2">
                              {r.zprava}
                            </p>
                          ) : null}
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-600">Štítek</Label>
                            <Select
                              value={currentTag || "__none__"}
                              onValueChange={(v) => void handleTagChange(r, v === "__none__" ? null : v)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Vyberte štítek" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Bez štítku</SelectItem>
                                {tags.map((t) => (
                                  <SelectItem key={t.id} value={t.id!}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {canMeasure ? (
                            <Button asChild className="w-full min-h-[44px] bg-orange-500 hover:bg-orange-600">
                              <Link href={buildMeasurementPrefillHref(r)}>
                                <Ruler className="w-4 h-4 mr-2" />
                                Zaměřit
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
