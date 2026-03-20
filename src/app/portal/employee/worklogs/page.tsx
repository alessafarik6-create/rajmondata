"use client";

/**
 * Výkaz práce — jediná kanonická route: /portal/employee/worklogs
 */
import React, { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { cs as csFns } from "date-fns/locale";
import { cs } from "react-day-picker/locale";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  query,
  where,
  limit,
  addDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  hoursBetween,
  minutesFromHm,
  formatHm,
  parseHmStrict,
  isWorklogDateLocked,
  blockOverlapsExisting,
} from "@/lib/work-time-block";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, Merge, AlertCircle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getReviewLabel } from "@/lib/employee-money";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const DEBUG = process.env.NODE_ENV === "development";

const HOUR_OPTS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTS = Array.from({ length: 60 }, (_, i) => i);

const inputBaseClass =
  "h-12 min-h-[48px] rounded-md border border-slate-300 bg-white text-base text-black placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

const selectBaseClass =
  "h-12 min-h-[48px] w-full rounded-md border border-slate-300 bg-white px-3 text-base font-medium text-black focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60";

type WorkBlock = {
  id: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  originalHours?: number;
  approvedHours?: number;
  adminNote?: string;
  adjustmentReason?: string;
  reviewStatus?: string;
  description?: string;
  employeeId?: string;
  companyId?: string;
  authUserId?: string;
};

function canEmployeeDeleteBlock(b: WorkBlock): boolean {
  const st = b.reviewStatus;
  if (st === "approved" || st === "adjusted") return false;
  return true;
}

function reviewBadgeVariant(
  status?: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "pending") return "secondary";
  if (status === "rejected") return "destructive";
  if (status === "adjusted") return "outline";
  return "default";
}

function DigitalTimePair({
  label,
  valueHm,
  onChange,
  disabled,
  idPrefix,
}: {
  label: string;
  valueHm: string;
  onChange: (hm: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const parsed = parseHmStrict(valueHm);
  const h = parsed?.h ?? 0;
  const m = parsed?.m ?? 0;

  const apply = (nextH: number, nextM: number) => {
    onChange(formatHm(nextH, nextM));
  };

  return (
    <div className="space-y-2">
      <Label
        htmlFor={`${idPrefix}-h`}
        className="text-sm font-semibold text-black"
      >
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <select
          id={`${idPrefix}-h`}
          className={selectBaseClass}
          disabled={disabled}
          value={h}
          onChange={(e) => apply(Number(e.target.value), m)}
          aria-label={`${label} — hodiny`}
        >
          {HOUR_OPTS.map((hh) => (
            <option key={hh} value={hh}>
              {String(hh).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span className="text-xl font-bold text-black" aria-hidden>
          :
        </span>
        <select
          id={`${idPrefix}-m`}
          className={selectBaseClass}
          disabled={disabled}
          value={m}
          onChange={(e) => apply(h, Number(e.target.value))}
          aria-label={`${label} — minuty`}
        >
          {MINUTE_OPTS.map((mm) => (
            <option key={mm} value={mm}>
              {String(mm).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-slate-500">
        Formát HH:mm — digitální výběr (bez ručiček).
      </p>
    </div>
  );
}

export default function EmployeeWorklogsPage() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName, isLoading: companyLoading } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } =
    useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const blocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !user?.uid) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId, user?.uid]);

  const {
    data: blocksRaw,
    isLoading: blocksLoading,
    error: blocksError,
  } = useCollection(blocksQuery);

  const blocksRawSafe = Array.isArray(blocksRaw) ? blocksRaw : [];

  const blocks = useMemo(() => {
    const list = (blocksRawSafe as WorkBlock[]).map((b: any) => ({
      ...b,
      id: String(b?.id ?? ""),
    }));
    list.sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    return list;
  }, [blocksRawSafe]);

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [mergeIds, setMergeIds] = useState<Record<string, boolean>>({});

  const datesWithData = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) {
      if (b.date) s.add(String(b.date));
    }
    return s;
  }, [blocks]);

  const dayKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : "";

  const dayBlocks = useMemo(
    () => blocks.filter((b) => b.date === dayKey),
    [blocks, dayKey]
  );

  const dayLocked = useMemo(
    () => (selectedDay ? isWorklogDateLocked(selectedDay) : false),
    [selectedDay]
  );

  useEffect(() => {
    if (!DEBUG) return;
    console.log("[employee/worklogs]", {
      route: pathname,
      userUid: user?.uid ?? null,
      employeeProfile: profile
        ? {
            id: profile.id,
            employeeId: profile.employeeId,
            companyId: profile.companyId,
          }
        : null,
      companyId: companyId ?? null,
      employeeId: employeeId ?? null,
      isUserLoading,
      profileLoading,
      blocksLoading,
      companyLoading,
      rawWorklogsData: blocksRawSafe,
      transformedWorklogsData: blocks,
      profileError: profileError?.message ?? null,
      blocksError: blocksError?.message ?? null,
    });
  }, [
    pathname,
    user?.uid,
    profile,
    companyId,
    employeeId,
    isUserLoading,
    profileLoading,
    blocksLoading,
    companyLoading,
    blocksRawSafe,
    blocks,
    profileError,
    blocksError,
  ]);

  const openDay = (d: Date | undefined) => {
    setSelectedDay(d);
    if (d) setDialogOpen(true);
  };

  const handleAddBlock = async () => {
    if (!user || !companyId || !employeeId || !dayKey) return;
    if (dayLocked) {
      toast({
        variant: "destructive",
        title: "Den je uzamčen",
        description:
          "Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.",
      });
      return;
    }
    if (!newDesc.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí popis",
        description: "Vyplňte stručný popis práce, aby byl záznam platný.",
      });
      return;
    }
    if (!parseHmStrict(newStart) || !parseHmStrict(newEnd)) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Zkontrolujte čas od a do (formát HH:mm).",
      });
      return;
    }
    const h = hoursBetween(newStart, newEnd);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Čas „od“ musí být před časem „do“.",
      });
      return;
    }
    if (blockOverlapsExisting(newStart, newEnd, dayBlocks)) {
      toast({
        variant: "destructive",
        title: "Překryv bloků",
        description:
          "V tomto čase už máte jiný záznam. Upravte časy nebo sloučte bloky.",
      });
      return;
    }
    setSaving(true);
    try {
      await addDoc(
        collection(firestore, "companies", companyId, "work_time_blocks"),
        {
          companyId,
          employeeId,
          authUserId: user.uid,
          date: dayKey,
          startTime: newStart,
          endTime: newEnd,
          hours: h,
          originalHours: h,
          approvedHours: h,
          reviewStatus: "pending",
          description: newDesc.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Uloženo",
        description: "Blok práce byl úspěšně přidán.",
      });
      setNewDesc("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se uložit výkaz.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, block?: WorkBlock) => {
    if (dayLocked) {
      toast({
        variant: "destructive",
        title: "Den je uzamčen",
        description:
          "Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.",
      });
      return;
    }
    if (block && !canEmployeeDeleteBlock(block)) {
      toast({
        variant: "destructive",
        title: "Nelze smazat",
        description:
          "Schválený nebo upravený výkaz může odstranit jen administrátor.",
      });
      return;
    }
    if (!companyId || !id) return;
    if (!confirm("Smazat tento blok?")) return;
    try {
      await deleteDoc(
        doc(firestore, "companies", companyId, "work_time_blocks", id)
      );
      toast({
        title: "Smazáno",
        description: "Blok byl odstraněn.",
      });
    } catch {
      toast({ variant: "destructive", title: "Smazání se nezdařilo" });
    }
  };

  const handleMerge = async () => {
    if (dayLocked) {
      toast({
        variant: "destructive",
        title: "Den je uzamčen",
        description:
          "Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.",
      });
      return;
    }
    const ids = Object.keys(mergeIds).filter((k) => mergeIds[k]);
    if (ids.length < 2) {
      toast({
        variant: "destructive",
        title: "Vyberte 2+ bloky",
        description: "Zaškrtněte alespoň dva záznamy ze stejného dne.",
      });
      return;
    }
    const chosen = dayBlocks.filter((b) => ids.includes(b.id));
    if (chosen.length < 2) return;
    if (
      chosen.some(
        (b) => b.reviewStatus === "approved" || b.reviewStatus === "adjusted"
      )
    ) {
      toast({
        variant: "destructive",
        title: "Nelze spojit",
        description:
          "Schválené bloky nelze sloučit. Požádejte administrátora o úpravu.",
      });
      return;
    }

    const startTime = chosen.reduce((min, b) => {
      const t = b.startTime || "99:99";
      const m = minutesFromHm(t);
      const cur = minutesFromHm(min);
      if (!Number.isFinite(m)) return min;
      if (!Number.isFinite(cur)) return t;
      return m < cur ? t : min;
    }, chosen[0].startTime || "00:00");
    const endTime = chosen.reduce((max, b) => {
      const t = b.endTime || "00:00";
      const m = minutesFromHm(t);
      const cur = minutesFromHm(max);
      if (!Number.isFinite(m)) return max;
      if (!Number.isFinite(cur)) return t;
      return m > cur ? t : max;
    }, chosen[0].endTime || "00:00");
    const h = hoursBetween(startTime, endTime);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Nelze spojit",
        description: "Zkontrolujte časy vybraných bloků.",
      });
      return;
    }
    const description = chosen
      .map((b) => b.description?.trim())
      .filter(Boolean)
      .join(" · ");

    if (!user || !companyId || !employeeId) return;
    setSaving(true);
    try {
      const batch = writeBatch(firestore);
      const newRef = doc(
        collection(firestore, "companies", companyId, "work_time_blocks")
      );
      batch.set(newRef, {
        companyId,
        employeeId,
        authUserId: user.uid,
        date: dayKey,
        startTime,
        endTime,
        hours: h,
        originalHours: h,
        approvedHours: h,
        reviewStatus: "pending",
        description,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        mergedFrom: ids,
      });
      for (const id of ids) {
        batch.delete(
          doc(firestore, "companies", companyId, "work_time_blocks", id)
        );
      }
      await batch.commit();
      setMergeIds({});
      toast({
        title: "Sloučeno",
        description: "Vybrané bloky byly spojeny do jednoho záznamu.",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Sloučení selhalo",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Profil nebyl nalezen</AlertTitle>
        <AlertDescription>Kontaktujte administrátora.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Chybí organizace</AlertTitle>
        <AlertDescription>
          Nelze načíst výkaz bez přiřazení k firmě.
        </AlertDescription>
      </Alert>
    );
  }

  if (!employeeId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Profil zaměstnance nebyl nalezen</AlertTitle>
        <AlertDescription>
          V účtu chybí <code className="text-xs">employeeId</code>. Kontaktujte
          administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba profilu</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 pb-8 sm:px-0">
      <div>
        <h1 className="portal-page-title text-2xl text-black sm:text-3xl">
          Výkaz práce
        </h1>
        <p className="portal-page-description mt-1 text-base text-slate-800">
          Kalendář a záznamy po hodinových blocích.{" "}
          {companyName && companyName !== "Organization" ? companyName : ""}
        </p>
      </div>

      {blocksError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Bloky práce nelze načíst</AlertTitle>
          <AlertDescription className="text-black">
            {blocksError.message ||
              "Zkontrolujte oprávnění nebo zkuste stránku obnovit."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-black">Vyberte den</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 md:flex-row md:gap-8">
          <div className="mx-auto w-full max-w-[340px] md:mx-0">
            <Calendar
              mode="single"
              selected={selectedDay}
              onSelect={(d) => {
                setSelectedDay(d);
                if (d) setDialogOpen(true);
              }}
              locale={cs}
              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-black sm:p-3"
              classNames={{
                caption_label: "text-base font-semibold text-black",
                head_cell:
                  "w-9 text-[0.8rem] font-medium text-black/80 md:w-10",
                day: cn(
                  buttonVariants({ variant: "ghost" }),
                  "h-10 w-10 p-0 text-base font-semibold text-black hover:bg-primary/15 md:h-11 md:w-11"
                ),
                day_today: "bg-primary/15 font-bold text-black",
                day_selected:
                  "bg-primary font-bold text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              }}
              modifiers={{
                hasData: (date) =>
                  datesWithData.has(format(date, "yyyy-MM-dd")),
                lockedDay: (date) => isWorklogDateLocked(date),
              }}
              modifiersClassNames={{
                hasData:
                  "bg-primary/15 font-bold text-black ring-1 ring-primary/30",
                lockedDay:
                  "opacity-55 text-slate-800 line-through decoration-slate-400",
              }}
            />
          </div>
          <div className="flex-1 space-y-4 text-base text-black">
            <p>
              Dny se záznamem jsou zvýrazněné. Klepnutím na datum otevřete detail
              dne. Sloučení více bloků: zaškrtněte je a použijte „Spojit
              vybrané“.
            </p>
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              <Lock className="mb-0.5 mr-1 inline h-4 w-4 align-text-bottom" />
              Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.
              Starší dny jsou jen pro čtení.
            </p>
            <Button
              type="button"
              className="h-12 min-h-[48px] w-full text-base sm:w-auto"
              variant="outline"
              onClick={() => openDay(new Date())}
            >
              Dnešní den
            </Button>
            {!blocksLoading && blocks.length === 0 ? (
              <p className="text-sm font-medium text-slate-800">
                Zatím nejsou dostupné žádné záznamy výkazu práce.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={cn(
            "flex max-h-[min(92dvh,920px)] flex-col gap-0 border-slate-200 bg-white p-0 text-black shadow-xl",
            "w-full max-w-lg overflow-hidden sm:rounded-xl",
            "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:max-h-[95dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0"
          )}
        >
          <div className="max-h-[inherit] flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-14 sm:p-6 sm:pt-6">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl text-black sm:text-2xl">
                {selectedDay
                  ? format(selectedDay, "EEEE d. M. yyyy", { locale: csFns })
                  : "Den"}
              </DialogTitle>
              <DialogDescription className="text-left text-base text-slate-700">
                {dayKey ? `Datum: ${dayKey}` : ""}
              </DialogDescription>
            </DialogHeader>

            {dayLocked ? (
              <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-950">
                <Lock className="h-4 w-4 text-amber-800" />
                <AlertTitle className="text-black">
                  Tento den je uzamčen
                </AlertTitle>
                <AlertDescription className="text-slate-900">
                  Zápis výkazu práce je možný pouze do 24 hodin od konce daného
                  dne. Záznamy můžete prohlížet, ale nelze je měnit.
                </AlertDescription>
              </Alert>
            ) : null}

            {blocksLoading ? (
              <div className="mt-6 flex items-center gap-3 text-black">
                <Loader2 className="h-8 w-8 shrink-0 animate-spin text-primary" />
                <span className="text-base font-medium">
                  Načítání záznamů…
                </span>
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Label className="text-base font-semibold text-black">
                      Záznamy ({dayKey})
                    </Label>
                    {Object.values(mergeIds).filter(Boolean).length >= 2 && (
                      <Button
                        type="button"
                        className="h-12 min-h-[48px] w-full text-base sm:w-auto"
                        variant="secondary"
                        onClick={handleMerge}
                        disabled={saving || dayLocked}
                      >
                        <Merge className="mr-2 h-5 w-5" /> Spojit vybrané
                      </Button>
                    )}
                  </div>

                  {dayBlocks.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-base text-black">
                      Zatím nejsou dostupné žádné záznamy výkazu práce.
                    </p>
                  ) : (
                    <>
                      {/* Mobil: karty */}
                      <ul className="flex flex-col gap-3 md:hidden">
                        {dayBlocks.map((b, idx) => (
                          <li
                            key={b.id || `block-${dayKey}-${idx}`}
                            className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={!!mergeIds[b.id]}
                                  disabled={dayLocked}
                                  onCheckedChange={(c) =>
                                    setMergeIds((prev) => ({
                                      ...prev,
                                      [b.id]: c === true,
                                    }))
                                  }
                                  className="h-5 w-5 border-slate-400"
                                />
                                <span className="text-sm font-semibold text-black">
                                  Blok
                                </span>
                                <Badge
                                  variant={reviewBadgeVariant(b.reviewStatus)}
                                  className="text-xs font-semibold"
                                >
                                  {getReviewLabel(b.reviewStatus)}
                                </Badge>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 text-destructive hover:bg-red-50"
                                onClick={() => b.id && handleDelete(b.id, b)}
                                disabled={
                                  !b.id ||
                                  dayLocked ||
                                  !canEmployeeDeleteBlock(b)
                                }
                                aria-label="Smazat blok"
                              >
                                <Trash2 className="h-5 w-5" />
                              </Button>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <dt className="font-semibold text-black">Od</dt>
                                <dd className="text-black">{b.startTime ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-black">Do</dt>
                                <dd className="text-black">{b.endTime ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-black">
                                  Hodiny (zápis)
                                </dt>
                                <dd className="text-black">{b.hours ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-black">
                                  Schváleno (h)
                                </dt>
                                <dd className="text-black">
                                  {b.reviewStatus === "pending"
                                    ? "—"
                                    : (b.approvedHours ?? b.hours ?? "—")}
                                </dd>
                              </div>
                              <div className="col-span-2">
                                <dt className="font-semibold text-black">
                                  Popis
                                </dt>
                                <dd className="break-words text-black">
                                  {b.description?.trim() || "—"}
                                </dd>
                              </div>
                              {(b.adminNote || b.adjustmentReason) && (
                                <div className="col-span-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-black">
                                  {b.adjustmentReason ? (
                                    <p>
                                      <span className="font-semibold">
                                        Důvod úpravy:{" "}
                                      </span>
                                      {b.adjustmentReason}
                                    </p>
                                  ) : null}
                                  {b.adminNote ? (
                                    <p className="mt-1">
                                      <span className="font-semibold">
                                        Poznámka:{" "}
                                      </span>
                                      {b.adminNote}
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </dl>
                          </li>
                        ))}
                      </ul>
                      {/* Desktop: tabulka */}
                      <div className="hidden overflow-x-auto rounded-md border border-slate-200 md:block">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-200 hover:bg-transparent">
                              <TableHead className="w-10 text-black" />
                              <TableHead className="text-black">Od</TableHead>
                              <TableHead className="text-black">Do</TableHead>
                              <TableHead className="text-black">H</TableHead>
                              <TableHead className="text-black whitespace-nowrap">
                                Schv. h
                              </TableHead>
                              <TableHead className="text-black">Stav</TableHead>
                              <TableHead className="text-black">Popis</TableHead>
                              <TableHead className="w-12 text-black" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dayBlocks.map((b, idx) => (
                              <TableRow
                                key={b.id || `block-${dayKey}-${idx}`}
                                className="border-slate-200"
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={!!mergeIds[b.id]}
                                    disabled={dayLocked}
                                    onCheckedChange={(c) =>
                                      setMergeIds((prev) => ({
                                        ...prev,
                                        [b.id]: c === true,
                                      }))
                                    }
                                    className="h-5 w-5 border-slate-400"
                                  />
                                </TableCell>
                                <TableCell className="font-medium text-black">
                                  {b.startTime ?? "—"}
                                </TableCell>
                                <TableCell className="font-medium text-black">
                                  {b.endTime ?? "—"}
                                </TableCell>
                                <TableCell className="text-black">
                                  {b.hours ?? "—"}
                                </TableCell>
                                <TableCell className="text-black">
                                  {b.reviewStatus === "pending"
                                    ? "—"
                                    : (b.approvedHours ?? b.hours ?? "—")}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={reviewBadgeVariant(b.reviewStatus)}
                                    className="whitespace-nowrap text-xs font-semibold"
                                  >
                                    {getReviewLabel(b.reviewStatus)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate text-black">
                                  {b.description || "—"}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-10 w-10 text-destructive"
                                    onClick={() => b.id && handleDelete(b.id, b)}
                                    disabled={
                                      !b.id ||
                                      dayLocked ||
                                      !canEmployeeDeleteBlock(b)
                                    }
                                    aria-label="Smazat"
                                  >
                                    <Trash2 className="h-5 w-5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-4 border-t border-slate-200 pt-4">
                  <Label className="text-lg font-bold text-black">
                    Nový blok
                  </Label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DigitalTimePair
                      label="Čas od"
                      valueHm={newStart}
                      onChange={setNewStart}
                      disabled={dayLocked || saving}
                      idPrefix="new-start"
                    />
                    <DigitalTimePair
                      label="Čas do"
                      valueHm={newEnd}
                      onChange={setNewEnd}
                      disabled={dayLocked || saving}
                      idPrefix="new-end"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="worklog-desc"
                      className="text-sm font-semibold text-black"
                    >
                      Popis práce <span className="text-red-600">*</span>
                    </Label>
                    <Textarea
                      id="worklog-desc"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={3}
                      disabled={dayLocked || saving}
                      placeholder="Stručně popište práci v daném čase…"
                      className={cn(
                        inputBaseClass,
                        "min-h-[96px] resize-y py-3"
                      )}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4"
            style={{
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
          >
            <DialogFooter className="flex w-full flex-col gap-3 sm:flex-row sm:justify-end sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 min-h-[48px] w-full text-base sm:w-auto"
                onClick={() => setDialogOpen(false)}
              >
                Zavřít
              </Button>
              <Button
                type="button"
                className="h-12 min-h-[48px] w-full text-base font-semibold sm:w-auto"
                onClick={handleAddBlock}
                disabled={saving || dayLocked || blocksLoading}
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-2 h-5 w-5" /> Přidat blok
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
