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
  Calendar,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
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
  query,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import { cn } from "@/lib/utils";
import {
  LEAD_TAG_COLOR_PRESETS,
  contrastTextForBg,
  normalizeLeadTagColor,
} from "@/lib/lead-tag-colors";
import { getInquiryTypeBadgeClass } from "@/lib/inquiry-type-badge";

const POLL_MS = 5 * 60 * 1000;

type LeadTagRow = {
  id?: string;
  name?: string;
  sortOrder?: number;
  companyId?: string;
  color?: string;
};

function LeadTagBadge({
  label,
  color,
  className,
}: {
  label: string;
  color?: string;
  className?: string;
}) {
  const bg = normalizeLeadTagColor(color);
  const fg = contrastTextForBg(bg);
  return (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-md border border-black/10 px-2 py-0.5 text-xs font-medium",
        className
      )}
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}

type LeadOverlayRow = {
  id?: string;
  companyId?: string;
  importLeadId?: string;
  tagId?: string | null;
  internalNote?: string;
  /** Datum přijetí (import nebo první zobrazení v aplikaci). */
  receivedAt?: unknown;
  lastSyncedAt?: unknown;
  jmeno?: string;
  telefon?: string;
  email?: string;
  adresa?: string;
  zprava?: string;
  typ?: string;
  typ_poptavky?: string;
  stav?: string;
  externalId?: string;
  sourceId?: string;
  importSourceUrl?: string;
};

function overlayReceivedDate(ov: LeadOverlayRow | undefined): Date | null {
  if (!ov) return null;
  const r = ov.receivedAt;
  if (
    r &&
    typeof r === "object" &&
    "toDate" in r &&
    typeof (r as Timestamp).toDate === "function"
  ) {
    return (r as Timestamp).toDate();
  }
  return null;
}

function leadReceivedDate(lead: LeadImportRow, ov: LeadOverlayRow | undefined): Date | null {
  if (lead.receivedAtIso) {
    const d = new Date(lead.receivedAtIso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return overlayReceivedDate(ov);
}

function formatReceivedDay(d: Date): string {
  return format(d, "d. M. yyyy", { locale: cs });
}

type ApiImportBody = {
  ok?: boolean;
  rows?: LeadImportRow[];
  warning?: string;
  error?: string;
  code?: string;
  importUrlDebug?: string;
  sync?: {
    created: number;
    updated: number;
    skipped: number;
    total: number;
  };
};

function leadSearchBlob(r: LeadImportRow): string {
  return [
    r.jmeno,
    r.telefon,
    r.email,
    r.adresa,
    r.zprava,
    r.typ,
    r.stav,
    r.id,
    r.receivedAtIso,
    r.orientacniCenaKc != null ? String(r.orientacniCenaKc) : "",
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

  const meetingsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "lead_meetings"),
      orderBy("scheduledAt", "asc"),
      limit(500)
    );
  }, [firestore, companyId]);

  const { data: tagsRaw, isLoading: tagsLoading } = useCollection(tagsQuery);
  const { data: overlaysRaw } = useCollection(overlaysQuery);
  const { data: meetingsRaw } = useCollection(meetingsQuery);

  const tags = useMemo(() => {
    const list = Array.isArray(tagsRaw) ? (tagsRaw as LeadTagRow[]) : [];
    return [...list]
      .filter((t) => t?.id)
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  }, [tagsRaw]);

  const tagById = useMemo(() => {
    const m = new Map<string, LeadTagRow>();
    for (const t of tags) {
      if (t.id) m.set(t.id, t);
    }
    return m;
  }, [tags]);

  const overlayByDocId = useMemo(() => {
    const m = new Map<string, LeadOverlayRow>();
    const list = Array.isArray(overlaysRaw) ? overlaysRaw : [];
    for (const d of list) {
      const row = d as LeadOverlayRow & { id?: string };
      if (row.id) m.set(row.id, row);
    }
    return m;
  }, [overlaysRaw]);

  /** Nejbližší budoucí schůzka na leadKey (pro zobrazení u řádku). */
  const nextMeetingByLeadKey = useMemo(() => {
    const map = new Map<string, Date>();
    const list = Array.isArray(meetingsRaw) ? meetingsRaw : [];
    const now = Date.now();
    for (const raw of list as Record<string, unknown>[]) {
      const lk = typeof raw.leadKey === "string" ? raw.leadKey : "";
      const t = parseFirestoreScheduledAt(raw.scheduledAt);
      if (!lk || !t) continue;
      if (t.getTime() < now - 120_000) continue;
      const prev = map.get(lk);
      if (!prev || t.getTime() < prev.getTime()) map.set(lk, t);
    }
    return map;
  }, [meetingsRaw]);

  const [rows, setRows] = useState<LeadImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorDebugUrl, setErrorDebugUrl] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterTyp, setFilterTyp] = useState<string>("");
  const [filterTag, setFilterTag] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#0ea5e9");
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    color: string;
  } | null>(null);
  const [savingTag, setSavingTag] = useState(false);

  const [meetingLead, setMeetingLead] = useState<LeadImportRow | null>(null);
  const [meetingCustomerName, setMeetingCustomerName] = useState("");
  const [meetingDateStr, setMeetingDateStr] = useState("");
  const [meetingHour, setMeetingHour] = useState("9");
  const [meetingMinute, setMeetingMinute] = useState("0");
  const [meetingPlace, setMeetingPlace] = useState("");
  const [meetingNote, setMeetingNote] = useState("");
  const [savingMeeting, setSavingMeeting] = useState(false);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNoteKey, setSavingNoteKey] = useState<string | null>(null);
  const [expandedLeadKeys, setExpandedLeadKeys] = useState<Record<string, boolean>>({});

  const toggleLeadExpanded = useCallback((key: string) => {
    setExpandedLeadKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const loadLeads = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? true;
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
          if (!silent && data.sync) {
            const s = data.sync;
            toast({
              title: "Synchronizace poptávek",
              description: `${s.created} nových, ${s.updated} aktualizováno, ${s.skipped} duplicit přeskočeno při slučování, celkem ${s.total} záznamů.`,
            });
          }
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
    },
    [companyId, user, toast]
  );

  useEffect(() => {
    if (!companyId || isUserLoading || !user) return;
    void loadLeads({ silent: true });
  }, [companyId, isUserLoading, user, loadLeads]);

  useEffect(() => {
    if (!companyId || !user) return;
    const t = window.setInterval(() => void loadLeads({ silent: true }), POLL_MS);
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

  const sortedFilteredRows = useMemo(() => {
    const list = [...filteredRows];
    const getTs = (r: LeadImportRow) => {
      const key = stableImportLeadDocumentId(r);
      const ov = overlayByDocId.get(key);
      const d = leadReceivedDate(r, ov);
      return d ? d.getTime() : 0;
    };
    list.sort((a, b) => {
      const ta = getTs(a);
      const tb = getTs(b);
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [filteredRows, overlayByDocId, sortOrder]);

  const rowsKey = useMemo(
    () => rows.map((r) => stableImportLeadDocumentId(r)).join("|"),
    [rows]
  );

  /** Otevření konkrétní poptávky z dashboardu (?openLead=…) */
  useEffect(() => {
    if (typeof window === "undefined" || rows.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const open = params.get("openLead");
    if (!open) return;
    const exists = rows.some((r) => stableImportLeadDocumentId(r) === open);
    if (!exists) return;
    setExpandedLeadKeys((p) => ({ ...p, [open]: true }));
    const t = window.setTimeout(() => {
      try {
        const el = document.querySelector(`[data-open-lead="${CSS.escape(open)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        /* starší prohlížeče bez CSS.escape */
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [rows, rowsKey]);

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
        color: normalizeLeadTagColor(newTagColor),
        sortOrder: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewTagName("");
      setNewTagColor("#0ea5e9");
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
        color: normalizeLeadTagColor(editingTag.color),
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

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const openMeetingDialog = (lead: LeadImportRow) => {
    setMeetingLead(lead);
    setMeetingCustomerName(String(lead.jmeno ?? "").trim());
    setMeetingDateStr(format(new Date(), "yyyy-MM-dd"));
    setMeetingHour("9");
    setMeetingMinute("0");
    setMeetingPlace("");
    setMeetingNote("");
  };

  const handleSaveMeeting = async () => {
    if (!meetingLead || !firestore || !companyId || !user) return;
    const h = Math.min(23, Math.max(0, parseInt(meetingHour, 10) || 0));
    const mi = Math.min(59, Math.max(0, parseInt(meetingMinute, 10) || 0));
    if (!meetingDateStr?.trim()) {
      toast({ variant: "destructive", title: "Vyberte datum" });
      return;
    }
    const d = new Date(`${meetingDateStr.trim()}T${pad2(h)}:${pad2(mi)}:00`);
    if (Number.isNaN(d.getTime())) {
      toast({ variant: "destructive", title: "Neplatný datum a čas" });
      return;
    }
    setSavingMeeting(true);
    try {
      const leadKey = stableImportLeadDocumentId(meetingLead);
      await addDoc(collection(firestore, "companies", companyId, "lead_meetings"), {
        companyId,
        leadKey,
        importLeadId: meetingLead.id,
        customerName: meetingCustomerName.trim() || String(meetingLead.jmeno ?? "").trim() || "—",
        phone: String(meetingLead.telefon ?? "").trim(),
        email: String(meetingLead.email ?? "").trim(),
        place: meetingPlace.trim(),
        note: meetingNote.trim(),
        scheduledAt: Timestamp.fromDate(d),
        calendarEventType: "lead_meeting",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({
        title: "Schůzka naplánována",
        description: format(d, "d. M. yyyy HH:mm", { locale: cs }),
      });
      setMeetingLead(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Schůzku se nepodařilo uložit." });
    } finally {
      setSavingMeeting(false);
    }
  };

  const getNoteValue = (key: string, ov: LeadOverlayRow | undefined) => {
    if (key in noteDraft) return noteDraft[key];
    return ov?.internalNote ?? "";
  };

  const saveInternalNote = async (lead: LeadImportRow) => {
    if (!firestore || !companyId || !user) return;
    const key = stableImportLeadDocumentId(lead);
    const text = getNoteValue(key, overlayByDocId.get(key));
    setSavingNoteKey(key);
    try {
      await setDoc(
        doc(firestore, "companies", companyId, "import_lead_overlays", key),
        {
          companyId,
          importLeadId: lead.id,
          internalNote: text.trim(),
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        },
        { merge: true }
      );
      toast({ title: "Interní poznámka uložena" });
      setNoteDraft((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Poznámku se nepodařilo uložit." });
    } finally {
      setSavingNoteKey(null);
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
          <Inbox className="h-7 w-7 text-orange-700 shrink-0" />
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
              <Label htmlFor="lead-search" className="text-xs text-slate-800">
                Vyhledávání
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-800" />
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
              <Label className="text-xs text-slate-800">Typ poptávky (ze zdroje)</Label>
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
              <Label className="text-xs text-slate-800">Štítek</Label>
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
            <div className="w-full sm:w-[200px] space-y-1.5">
              <Label className="text-xs text-slate-800">Řazení podle data přijetí</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              >
                <option value="newest">Nejnovější nahoře</option>
                <option value="oldest">Nejstarší nahoře</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2 min-h-[44px]"
                onClick={() => void loadLeads({ silent: false })}
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
          <p className="text-xs text-slate-800">
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
              Vytvářejte vlastní štítky pro firmu. Každou poptávku můžete označit v rozbaleném detailu u
              záznamu níže.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
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
              <div className="flex flex-wrap gap-1.5">
                {LEAD_TAG_COLOR_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.label}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 border-white shadow-sm transition ring-offset-2 hover:opacity-80",
                      normalizeLeadTagColor(newTagColor).toLowerCase() === p.hex.toLowerCase()
                        ? "ring-2 ring-slate-800 ring-offset-2"
                        : "ring-0"
                    )}
                    style={{ backgroundColor: p.hex }}
                    onClick={() => setNewTagColor(p.hex)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs text-slate-800">Vlastní barva</Label>
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0"
                  aria-label="Vlastní barva štítku"
                />
                <LeadTagBadge label="Náhled" color={newTagColor} />
              </div>
            </div>
            {tagsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <p className="text-sm text-slate-800">Zatím nemáte žádné štítky — vytvořte první výše.</p>
            ) : (
              <ul className="divide-y rounded-md border border-slate-200 max-h-[280px] overflow-y-auto">
                {tags.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LeadTagBadge label={t.name || t.id || ""} color={t.color} />
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9"
                        onClick={() =>
                          setEditingTag({
                            id: t.id!,
                            name: t.name || "",
                            color: normalizeLeadTagColor(t.color),
                          })
                        }
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
            <DialogTitle>Upravit štítek</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-tag-name">Název</Label>
              <Input
                id="edit-tag-name"
                value={editingTag?.name ?? ""}
                onChange={(e) =>
                  editingTag && setEditingTag({ ...editingTag, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-800">Barva</Label>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_TAG_COLOR_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.label}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 border-white shadow-sm transition ring-offset-2 hover:opacity-80",
                      editingTag &&
                        normalizeLeadTagColor(editingTag.color).toLowerCase() === p.hex.toLowerCase()
                        ? "ring-2 ring-slate-800 ring-offset-2"
                        : "ring-0"
                    )}
                    style={{ backgroundColor: p.hex }}
                    onClick={() =>
                      editingTag && setEditingTag({ ...editingTag, color: p.hex })
                    }
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={editingTag?.color ?? "#64748b"}
                  onChange={(e) =>
                    editingTag && setEditingTag({ ...editingTag, color: e.target.value })
                  }
                  className="h-8 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0"
                  aria-label="Vlastní barva štítku"
                />
                {editingTag ? (
                  <LeadTagBadge label={editingTag.name.trim() || "Náhled"} color={editingTag.color} />
                ) : null}
              </div>
            </div>
          </div>
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

      <Dialog open={!!meetingLead} onOpenChange={(o) => !o && setMeetingLead(null)}>
        <DialogContent className="sm:max-w-md bg-white border-slate-200 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Naplánovat schůzku
            </DialogTitle>
            <DialogDescription>
              Obchodní nebo úvodní schůzka s klientem. Termín uvidíte na přehledu firmy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="meet-name">Jméno klienta</Label>
              <Input
                id="meet-name"
                value={meetingCustomerName}
                onChange={(e) => setMeetingCustomerName(e.target.value)}
                placeholder="Jméno nebo firma"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meet-date">Den</Label>
              <Input
                id="meet-date"
                type="date"
                value={meetingDateStr}
                onChange={(e) => setMeetingDateStr(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hodina</Label>
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={meetingHour}
                  onChange={(e) => setMeetingHour(e.target.value)}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>
                      {pad2(i)} h
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Minuta</Label>
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={meetingMinute}
                  onChange={(e) => setMeetingMinute(e.target.value)}
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = i * 5;
                    return (
                      <option key={m} value={String(m)}>
                        {pad2(m)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meet-place">Místo schůzky (volitelné)</Label>
              <Input
                id="meet-place"
                value={meetingPlace}
                onChange={(e) => setMeetingPlace(e.target.value)}
                placeholder="Adresa nebo poznámka k místu"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meet-note">Poznámka ke schůzce (volitelné)</Label>
              <Textarea
                id="meet-note"
                rows={3}
                value={meetingNote}
                onChange={(e) => setMeetingNote(e.target.value)}
                placeholder="Co projednat, připomenutí…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setMeetingLead(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void handleSaveMeeting()}
              disabled={savingMeeting}
            >
              {savingMeeting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit schůzku"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-800">
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
                <p className="py-16 text-center text-sm text-slate-800">
                  Žádné poptávky nebyly nalezeny.
                </p>
              ) : filteredRows.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-800">
                  Žádné záznamy neodpovídají filtru.
                </p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {sortedFilteredRows.map((r, idx) => {
                    const key = stableImportLeadDocumentId(r);
                    const ov = overlayByDocId.get(key);
                    const currentTag = ov?.tagId ?? "";
                    const nextMt = nextMeetingByLeadKey.get(key);
                    const received = leadReceivedDate(r, ov);
                    const expanded = !!expandedLeadKeys[key];
                    const dateStr = received ? formatReceivedDay(received) : "—";

                    return (
                      <div
                        key={`${key}-${r.id}`}
                        data-open-lead={key}
                        className={cn(
                          idx % 2 === 1 ? "bg-slate-50/90" : "bg-white"
                        )}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleLeadExpanded(key);
                            }
                          }}
                          onClick={() => toggleLeadExpanded(key)}
                          className="flex cursor-pointer items-start gap-1.5 px-2 py-2 text-sm transition-colors hover:bg-slate-100/70 sm:gap-2 sm:px-3 sm:py-2 lg:items-center"
                        >
                          <ChevronDown
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0 text-slate-800 transition-transform duration-200 lg:mt-0",
                              expanded && "rotate-180"
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1 space-y-1.5 lg:space-y-0">
                            <div className="flex flex-col gap-1.5 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(0,auto)] lg:items-center lg:gap-x-4">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span className="max-w-full truncate font-medium text-slate-900">
                                  {r.jmeno || "—"}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-slate-800">
                                  {dateStr}
                                </span>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-700 sm:text-sm">
                                <span className="tabular-nums">{r.telefon || "—"}</span>
                                <span className="min-w-0 break-all text-slate-800 lg:max-w-none lg:truncate">
                                  {r.email || "—"}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {r.typ?.trim() ? (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] font-normal leading-none sm:text-xs"
                                  >
                                    {r.typ}
                                  </Badge>
                                ) : (
                                  <span className="text-[10px] text-slate-800 sm:text-xs">—</span>
                                )}
                                {currentTag && tagById.get(currentTag) ? (
                                  <LeadTagBadge
                                    label={tagById.get(currentTag)?.name ?? "Štítek"}
                                    color={tagById.get(currentTag)?.color}
                                    className="max-w-[10rem] sm:max-w-[14rem]"
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-800 sm:text-xs">Bez štítku</span>
                                )}
                                {nextMt ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-800 sm:text-xs"
                                    title="Nejbližší naplánovaná schůzka"
                                  >
                                    <Calendar className="h-3 w-3 shrink-0" />
                                    {format(nextMt, "d. M. HH:mm", { locale: cs })}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div
                            className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-center"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {canMeasure ? (
                              <Button
                                asChild
                                size="sm"
                                className="h-8 border-0 bg-orange-500 px-2 text-xs text-white hover:bg-orange-600 sm:h-9 sm:px-3"
                              >
                                <Link href={buildMeasurementPrefillHref(r)}>
                                  <Ruler className="mr-1 inline h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                  Zaměřit
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 border-emerald-600/40 px-2 text-xs text-emerald-900 hover:bg-emerald-50 sm:h-9 sm:px-3"
                              onClick={() => openMeetingDialog(r)}
                            >
                              <Calendar className="mr-1 inline h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              <span className="hidden sm:inline">Naplánovat schůzku</span>
                              <span className="sm:hidden">Schůzka</span>
                            </Button>
                          </div>
                        </div>

                        {expanded ? (
                          <div
                            className="border-b border-slate-200 bg-slate-100/60 px-3 py-3 sm:px-4 sm:py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="mx-auto max-w-4xl space-y-4">
                              {r.typ?.trim() ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-800">
                                    Typ poptávky
                                  </p>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "w-fit text-xs font-normal",
                                      getInquiryTypeBadgeClass(r.typ)
                                    )}
                                  >
                                    {r.typ}
                                  </Badge>
                                </div>
                              ) : null}
                              {r.adresa?.trim() ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-800">
                                    Adresa
                                  </p>
                                  <p className="whitespace-pre-wrap text-sm text-slate-800">{r.adresa}</p>
                                </div>
                              ) : null}
                              {r.zprava?.trim() ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-800">
                                    Text poptávky
                                  </p>
                                  <p className="whitespace-pre-wrap text-sm text-slate-700">{r.zprava}</p>
                                </div>
                              ) : null}
                              {r.orientacniCenaKc != null && Number.isFinite(r.orientacniCenaKc) ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-800">
                                    Orientační cena
                                  </p>
                                  <p className="text-sm text-slate-800">
                                    {new Intl.NumberFormat("cs-CZ").format(r.orientacniCenaKc)} Kč
                                  </p>
                                </div>
                              ) : null}
                              {nextMt ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200/80 bg-emerald-50/90 px-3 py-2 text-sm text-emerald-900">
                                  <Calendar className="h-4 w-4 shrink-0" />
                                  <span>
                                    Nejbližší schůzka:{" "}
                                    <strong className="tabular-nums">
                                      {format(nextMt, "d. M. yyyy HH:mm", { locale: cs })}
                                    </strong>
                                  </span>
                                </div>
                              ) : null}
                              <div className="space-y-2 border-t border-slate-200/80 pt-3">
                                <Label className="text-xs text-slate-800">Štítek</Label>
                                <Select
                                  value={currentTag || "__none__"}
                                  onValueChange={(v) =>
                                    void handleTagChange(r, v === "__none__" ? null : v)
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full max-w-md text-left text-sm">
                                    <SelectValue placeholder="Vyberte štítek" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Bez štítku</SelectItem>
                                    {tags.map((t) => (
                                      <SelectItem key={t.id} value={t.id!}>
                                        <span className="flex items-center gap-2">
                                          <span
                                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                                            style={{
                                              backgroundColor: normalizeLeadTagColor(t.color),
                                            }}
                                          />
                                          {t.name}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {currentTag && !tags.some((x) => x.id === currentTag) ? (
                                  <p className="text-xs text-amber-800">
                                    Štítek byl smazán — vyberte nový.
                                  </p>
                                ) : null}
                              </div>
                              <div className="space-y-2 border-t border-slate-200/80 pt-3">
                                <Label className="text-xs text-slate-800">Interní poznámka</Label>
                                <Textarea
                                  rows={2}
                                  className="min-h-[4rem] resize-y text-sm"
                                  value={getNoteValue(key, ov)}
                                  onChange={(e) =>
                                    setNoteDraft((d) => ({ ...d, [key]: e.target.value }))
                                  }
                                  placeholder="Poznámka jen pro váš tým…"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-12 min-h-[44px] sm:h-9 sm:min-h-0"
                                  onClick={() => void saveInternalNote(r)}
                                  disabled={savingNoteKey === key}
                                >
                                  {savingNoteKey === key ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    "Uložit poznámku"
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
