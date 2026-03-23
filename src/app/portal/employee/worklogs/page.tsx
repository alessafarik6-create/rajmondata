"use client";

/**
 * Výkaz práce — jediná kanonická route: /portal/employee/worklogs
 */
import React, { useEffect, useMemo, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  updateDoc,
  documentId,
  getDocs,
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
  WORKLOG_DESCRIPTION_MAX_LENGTH,
  normalizeWorklogDescription,
  isWorklogDescriptionTooLong,
} from "@/lib/work-time-block";
import {
  getLoggedHours,
  getReviewLabel,
  sumPayableHoursForBlocks,
} from "@/lib/employee-money";
import {
  buildWorklogPdfFileName,
  downloadWorklogPdfFromElement,
} from "@/lib/worklog-report-pdf";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Plus,
  Trash2,
  Merge,
  AlertCircle,
  Lock,
  Pencil,
  Printer,
  FileDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  parseAssignedWorklogJobIds,
  chunkArray,
  isJobIdAssigned,
} from "@/lib/assigned-jobs";
import { normalizeEmployeeUiLang } from "@/lib/i18n/employee-ui";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { isDailyWorkLogEnabled, isWorkLogEnabled } from "@/lib/employee-report-flags";
import {
  type WorkSegmentClient,
  closedTerminalSegmentsForDay,
  segmentClockHmRange,
  segmentTimeRangeLabel,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import {
  buildWorklogDescriptionPayload,
  getWorklogDescriptionOriginal,
  getWorklogLanguage,
  mergeWorklogDescriptionsForBlocks,
  type WorklogTextLanguage,
} from "@/lib/worklog-description-fields";

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
  employeeName?: string;
  companyId?: string;
  authUserId?: string;
  jobId?: string;
  jobName?: string;
  /** Uzavřený úsek z docházkového terminálu — čas bloku nelze měnit ručně. */
  attendanceSegmentId?: string;
  description_original?: string;
  description_translated?: string;
  language?: string;
};

function canEmployeeDeleteBlock(b: WorkBlock): boolean {
  const st = b.reviewStatus;
  if (st === "approved" || st === "adjusted") return false;
  return true;
}

function canEmployeeEditBlock(b: WorkBlock): boolean {
  return canEmployeeDeleteBlock(b);
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
  const router = useRouter();
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

  const { t } = useEmployeeUiLang(profile);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc } = useDoc<any>(employeeRef);

  useEffect(() => {
    if (!employeeDoc) return;
    if (isDailyWorkLogEnabled(employeeDoc)) {
      router.replace("/portal/employee/daily-reports");
    }
  }, [employeeDoc, router]);

  const assignedJobIds = useMemo(
    () => parseAssignedWorklogJobIds(employeeDoc),
    [employeeDoc]
  );
  const assignedJobIdsKey = useMemo(
    () => assignedJobIds.slice().sort().join("|"),
    [assignedJobIds]
  );

  const [assignedJobs, setAssignedJobs] = useState<{ id: string; name?: string }[]>(
    []
  );
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !companyId || assignedJobIds.length === 0) {
      setAssignedJobs([]);
      setJobsLoading(false);
      return;
    }
    let cancelled = false;
    setJobsLoading(true);
    void (async () => {
      try {
        const chunks = chunkArray(assignedJobIds, 10);
        const acc: { id: string; name?: string }[] = [];
        for (const chunk of chunks) {
          const q = query(
            collection(firestore, "companies", companyId, "jobs"),
            where(documentId(), "in", chunk)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data() as { name?: string };
            acc.push({ id: d.id, name: data.name });
          });
        }
        if (!cancelled) {
          acc.sort((a, b) =>
            (a.name || a.id).localeCompare(b.name || b.id, "cs")
          );
          setAssignedJobs(acc);
        }
      } catch (e) {
        console.error("[worklogs] load jobs", e);
        if (!cancelled) setAssignedJobs([]);
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, assignedJobIds, assignedJobIdsKey]);

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
  const [newDesc, setNewDesc] = useState("");
  const [newJobId, setNewJobId] = useState("");
  const [saving, setSaving] = useState(false);
  const [mergeIds, setMergeIds] = useState<Record<string, boolean>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editBlock, setEditBlock] = useState<WorkBlock | null>(null);
  const [editStart, setEditStart] = useState("09:00");
  const [editEnd, setEditEnd] = useState("10:00");
  const [editDesc, setEditDesc] = useState("");
  const [editJobId, setEditJobId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [newBlockLang, setNewBlockLang] = useState<WorklogTextLanguage>("cs");
  const [editLang, setEditLang] = useState<WorklogTextLanguage>("cs");
  const [newSegmentId, setNewSegmentId] = useState("");

  useEffect(() => {
    setNewBlockLang(
      normalizeEmployeeUiLang(profile?.language) === "ua" ? "ua" : "cs"
    );
  }, [profile?.language]);

  const employeeDisplayName = useMemo(() => {
    const en = [employeeDoc?.firstName, employeeDoc?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return en || user?.email || "";
  }, [employeeDoc, user?.email]);

  const worklogReportRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  const reportPeriodLabel = useMemo(() => {
    if (blocks.length === 0) return "Žádné záznamy v přehledu";
    const dates = blocks.map((b) => String(b.date ?? "")).filter(Boolean);
    const sorted = [...dates].sort();
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    return min === max ? `Datum: ${min}` : `Období: ${min} – ${max}`;
  }, [blocks]);

  const totalLoggedHoursSum = useMemo(() => {
    const s = blocks.reduce((acc, b) => acc + getLoggedHours(b), 0);
    return Math.round(s * 100) / 100;
  }, [blocks]);

  const totalPayableHoursSum = useMemo(
    () => Math.round(sumPayableHoursForBlocks(blocks) * 100) / 100,
    [blocks]
  );

  const handlePrintWorklog = () => {
    window.print();
  };

  const handleWorklogPdf = async () => {
    const el = worklogReportRef.current;
    if (!el) {
      toast({
        variant: "destructive",
        title: "Nelze exportovat",
        description: "Chybí oblast přehledu.",
      });
      return;
    }
    setPdfExporting(true);
    try {
      const prefix = `${companyName ?? "firma"}_${employeeDisplayName || "vykaz"}`;
      await downloadWorklogPdfFromElement(
        el,
        buildWorklogPdfFileName(prefix)
      );
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Export PDF se nezdařil",
        description: "Zkuste to znovu nebo použijte tisk do PDF v prohlížeči.",
      });
    } finally {
      setPdfExporting(false);
    }
  };

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

  const workSegmentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !dayKey) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      where("date", "==", dayKey)
    );
  }, [firestore, companyId, employeeId, dayKey]);

  const { data: workSegmentsRaw = [], isLoading: segmentsDayLoading } =
    useCollection<any>(workSegmentsQuery);

  const closedSegmentsDay = useMemo(() => {
    const raw = Array.isArray(workSegmentsRaw) ? workSegmentsRaw : [];
    const withId = raw.map((s: Record<string, unknown> & { id?: string }) => ({
      ...s,
      id: String(s.id ?? ""),
    })) as WorkSegmentClient[];
    return sortSegmentsByStart(closedTerminalSegmentsForDay(withId, dayKey));
  }, [workSegmentsRaw, dayKey]);

  const usedAttendanceSegmentIds = useMemo(() => {
    const u = new Set<string>();
    for (const b of dayBlocks) {
      const sid = String(b.attendanceSegmentId || "").trim();
      if (sid) u.add(sid);
    }
    return u;
  }, [dayBlocks]);

  const segmentsAvailableForNewBlock = useMemo(
    () => closedSegmentsDay.filter((s) => !usedAttendanceSegmentIds.has(s.id)),
    [closedSegmentsDay, usedAttendanceSegmentIds]
  );

  const workLogFeatureOn = isWorkLogEnabled(employeeDoc);

  useEffect(() => {
    setNewSegmentId("");
  }, [dayKey]);

  const mergeSelectionHasAttSegment = useMemo(() => {
    const ids = Object.keys(mergeIds).filter((k) => mergeIds[k]);
    return ids.some((id) =>
      Boolean(dayBlocks.find((b) => b.id === id)?.attendanceSegmentId)
    );
  }, [mergeIds, dayBlocks]);

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
    if (!workLogFeatureOn) {
      toast({
        variant: "destructive",
        title: "Funkce je vypnutá",
        description: "Administrátor vypnul výkaz práce v portálu.",
      });
      return;
    }
    if (dayLocked) {
      toast({
        variant: "destructive",
        title: "Den je uzamčen",
        description:
          "Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.",
      });
      return;
    }
    if (!normalizeWorklogDescription(newDesc)) {
      toast({
        variant: "destructive",
        title: "Chybí popis",
        description: "Vyplňte stručný popis práce, aby byl záznam platný.",
      });
      return;
    }
    if (isWorklogDescriptionTooLong(newDesc)) {
      toast({
        variant: "destructive",
        title: "Popis je příliš dlouhý",
        description: `Maximálně ${WORKLOG_DESCRIPTION_MAX_LENGTH} znaků.`,
      });
      return;
    }
    if (!newSegmentId.trim()) {
      toast({
        variant: "destructive",
        title: "Vyberte úsek docházky",
        description:
          "Čas bloku se bere z uzavřeného úseku docházkového terminálu — nelze zadat ručně.",
      });
      return;
    }
    const seg = closedSegmentsDay.find((s) => s.id === newSegmentId);
    if (!seg) {
      toast({
        variant: "destructive",
        title: "Neplatný úsek",
        description: "Úsek nebyl nalezen. Zkuste znovu vybrat den.",
      });
      return;
    }
    if (dayBlocks.some((b) => b.attendanceSegmentId === newSegmentId)) {
      toast({
        variant: "destructive",
        title: "Úsek je obsazený",
        description: "Pro tento úsek docházky už máte záznam výkazu.",
      });
      return;
    }
    const range = segmentClockHmRange(seg);
    if (!range) {
      toast({
        variant: "destructive",
        title: "Neplatný úsek",
        description: "U segmentu chybí čas začátku a konce.",
      });
      return;
    }
    const blockStart = range.startHm;
    const blockEnd = range.endHm;
    if (!parseHmStrict(blockStart) || !parseHmStrict(blockEnd)) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Zkontrolujte úsek docházky.",
      });
      return;
    }
    const h = hoursBetween(blockStart, blockEnd);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Úsek docházky má nulovou délku.",
      });
      return;
    }
    if (blockOverlapsExisting(blockStart, blockEnd, dayBlocks)) {
      toast({
        variant: "destructive",
        title: "Překryv bloků",
        description:
          "V tomto čase už máte jiný záznam. Upravte časy nebo sloučte bloky.",
      });
      return;
    }
    if (!newJobId.trim() || !isJobIdAssigned(assignedJobIds, newJobId)) {
      toast({
        variant: "destructive",
        title: "Vyberte zakázku",
        description: "Zvolte zakázku přiřazenou administrátorem.",
      });
      return;
    }
    const jobName =
      assignedJobs.find((j) => j.id === newJobId)?.name || "";
    const descPayload = buildWorklogDescriptionPayload(
      normalizeWorklogDescription(newDesc),
      newBlockLang
    );
    setSaving(true);
    try {
      await addDoc(
        collection(firestore, "companies", companyId, "work_time_blocks"),
        {
          companyId,
          employeeId,
          employeeName: employeeDisplayName,
          authUserId: user.uid,
          date: dayKey,
          startTime: blockStart,
          endTime: blockEnd,
          hours: h,
          originalHours: h,
          approvedHours: h,
          reviewStatus: "pending",
          ...descPayload,
          jobId: newJobId,
          jobName,
          attendanceSegmentId: newSegmentId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Uloženo",
        description: "Blok práce byl úspěšně přidán.",
      });
      setNewDesc("");
      setNewJobId("");
      setNewSegmentId("");
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
    if (chosen.some((b) => b.attendanceSegmentId)) {
      toast({
        variant: "destructive",
        title: "Nelze sloučit",
        description:
          "Bloky vázané na úseky docházky nelze sloučit — každý odpovídá jednomu uzavřenému úseku.",
      });
      return;
    }
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

    const firstJob = chosen[0]?.jobId;
    if (!firstJob || !chosen.every((b) => b.jobId === firstJob)) {
      toast({
        variant: "destructive",
        title: "Nelze spojit",
        description: "Vybrané bloky musí mít stejnou zakázku.",
      });
      return;
    }
    const mergedJobName = chosen[0]?.jobName || "";

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
    const descriptionParts = chosen.map((b) =>
      getWorklogDescriptionOriginal(b)
    );
    const description = descriptionParts.filter(Boolean).join(" · ");

    if (description.length > WORKLOG_DESCRIPTION_MAX_LENGTH) {
      toast({
        variant: "destructive",
        title: "Sloučený popis je příliš dlouhý",
        description: `Po sloučení zkraťte texty bloků (max. ${WORKLOG_DESCRIPTION_MAX_LENGTH} znaků).`,
      });
      return;
    }

    if (!user || !companyId || !employeeId) return;
    setSaving(true);
    try {
      const mergedPayload = mergeWorklogDescriptionsForBlocks(
        descriptionParts,
        normalizeEmployeeUiLang(profile?.language)
      );
      const batch = writeBatch(firestore);
      const newRef = doc(
        collection(firestore, "companies", companyId, "work_time_blocks")
      );
      batch.set(newRef, {
        companyId,
        employeeId,
        employeeName: employeeDisplayName,
        authUserId: user.uid,
        date: dayKey,
        startTime,
        endTime,
        hours: h,
        originalHours: h,
        approvedHours: h,
        reviewStatus: "pending",
        ...mergedPayload,
        jobId: firstJob,
        jobName: mergedJobName,
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

  const openEdit = (b: WorkBlock) => {
    if (!canEmployeeEditBlock(b)) return;
    setEditBlock(b);
    setEditStart(b.startTime || "09:00");
    setEditEnd(b.endTime || "10:00");
    setEditDesc(getWorklogDescriptionOriginal(b));
    setEditLang(getWorklogLanguage(b));
    setEditJobId(b.jobId || "");
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!user || !companyId || !editBlock?.id || !employeeId || !firestore) return;
    if (dayLocked) {
      toast({
        variant: "destructive",
        title: "Den je uzamčen",
        description:
          "Zápis výkazu práce je možný pouze do 24 hodin od konce daného dne.",
      });
      return;
    }
    if (!canEmployeeEditBlock(editBlock)) return;
    if (!normalizeWorklogDescription(editDesc)) {
      toast({
        variant: "destructive",
        title: "Chybí popis",
        description: "Vyplňte stručný popis práce.",
      });
      return;
    }
    if (isWorklogDescriptionTooLong(editDesc)) {
      toast({
        variant: "destructive",
        title: "Popis je příliš dlouhý",
        description: `Maximálně ${WORKLOG_DESCRIPTION_MAX_LENGTH} znaků.`,
      });
      return;
    }
    if (!editJobId.trim() || !isJobIdAssigned(assignedJobIds, editJobId)) {
      toast({
        variant: "destructive",
        title: "Vyberte zakázku",
        description: "Musíte zvolit zakázku přiřazenou vám administrátorem.",
      });
      return;
    }
    const timeLocked = Boolean(editBlock.attendanceSegmentId);
    const useStart = timeLocked ? (editBlock.startTime || "00:00") : editStart;
    const useEnd = timeLocked ? (editBlock.endTime || "00:00") : editEnd;
    if (!parseHmStrict(useStart) || !parseHmStrict(useEnd)) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Zkontrolujte čas od a do (formát HH:mm).",
      });
      return;
    }
    const h = hoursBetween(useStart, useEnd);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Čas „od“ musí být před časem „do“.",
      });
      return;
    }
    const others = dayBlocks.filter((b) => b.id !== editBlock.id);
    if (blockOverlapsExisting(useStart, useEnd, others)) {
      toast({
        variant: "destructive",
        title: "Překryv bloků",
        description:
          "V tomto čase už máte jiný záznam. Upravte časy tak, aby se nepřekrývaly.",
      });
      return;
    }
    const jobName =
      assignedJobs.find((j) => j.id === editJobId)?.name ||
      editBlock.jobName ||
      "";
    const descPayload = buildWorklogDescriptionPayload(
      normalizeWorklogDescription(editDesc),
      editLang
    );
    setEditSaving(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "work_time_blocks",
          editBlock.id
        ),
        {
          startTime: useStart,
          endTime: useEnd,
          hours: h,
          originalHours: h,
          approvedHours: h,
          ...descPayload,
          jobId: editJobId,
          jobName,
          updatedAt: serverTimestamp(),
        }
      );
      toast({ title: "Uloženo", description: "Blok byl aktualizován." });
      setEditOpen(false);
      setEditBlock(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Úpravu se nepodařilo uložit.",
      });
    } finally {
      setEditSaving(false);
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
      <div className="print:hidden">
        <h1 className="portal-page-title text-2xl text-black sm:text-3xl">
          {t("workReport")}
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

      {assignedJobIds.length === 0 && !jobsLoading && employeeDoc ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertCircle className="h-4 w-4 text-amber-800" />
          <AlertTitle className="text-black">Žádná přiřazená zakázka</AlertTitle>
          <AlertDescription className="text-slate-900">
            Nemůžete zapisovat výkaz, dokud vám administrátor nepřiřadí alespoň jednu zakázku
            (správa zaměstnanců → Přiřazené zakázky).
          </AlertDescription>
        </Alert>
      ) : null}

      {!workLogFeatureOn && employeeDoc ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Výkaz práce je vypnutý</AlertTitle>
          <AlertDescription>
            Administrátor vypnul tuto funkci pro váš účet. Kontaktujte vedení firmy, pokud jde o omyl.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-slate-200 bg-white shadow-sm print:hidden">
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

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            className="border-slate-300 text-black"
            disabled={blocksLoading || blocks.length === 0}
            onClick={handlePrintWorklog}
          >
            <Printer className="mr-2 h-4 w-4" />
            Tisk
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-slate-300 text-black"
            disabled={blocksLoading || blocks.length === 0 || pdfExporting}
            onClick={() => void handleWorklogPdf()}
          >
            {pdfExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export PDF
          </Button>
        </div>
        <div ref={worklogReportRef} className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-black print:border-0 print:bg-white print:p-0">
            <h2 className="text-xl font-bold tracking-tight text-black">
              Pracovní výkaz
            </h2>
            {companyName && companyName !== "Organization" ? (
              <p className="mt-1 text-sm text-slate-700">{companyName}</p>
            ) : null}
            <p className="mt-1 text-sm font-medium text-black">
              {employeeDisplayName || "—"}
            </p>
            <p className="mt-1 text-xs text-slate-600">{reportPeriodLabel}</p>
            <p className="mt-3 text-sm text-black">
              Součty: výkaz {totalLoggedHoursSum} h · schválený čas (započitatelné){" "}
              {totalPayableHoursSum} h
            </p>
          </div>
          <Card className="border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
            <CardHeader className="print:hidden">
              <CardTitle className="text-xl text-black">
                Přehled zapsaných bloků
              </CardTitle>
            </CardHeader>
            <CardContent>
              {blocksLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : blocks.length === 0 ? (
                <p className="text-sm text-slate-800">Zatím nemáte žádné záznamy.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200 print:border-slate-300">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-black">Datum</TableHead>
                        <TableHead className="text-black">Čas</TableHead>
                        <TableHead className="text-black">Zakázka</TableHead>
                        <TableHead className="min-w-[200px] max-w-[320px] text-black">
                          Popis práce
                        </TableHead>
                        <TableHead className="text-black">Hodiny</TableHead>
                        <TableHead className="text-black">Stav</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blocks.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium text-black">
                            {b.date}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-black">
                            {b.startTime}–{b.endTime}
                          </TableCell>
                          <TableCell className="max-w-[160px] align-top text-sm text-black">
                            <span className="break-words">
                              {b.jobName?.trim() || b.jobId || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[320px] align-top text-sm text-black">
                            <span className="whitespace-pre-wrap break-words">
                              {getWorklogDescriptionOriginal(b) || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-black">{b.hours ?? "—"}</TableCell>
                          <TableCell className="text-black">
                            {getReviewLabel(b.reviewStatus)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
                        disabled={saving || dayLocked || mergeSelectionHasAttSegment}
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
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-11 w-11 text-primary hover:bg-primary/10"
                                  onClick={() => openEdit(b)}
                                  disabled={
                                    !b.id ||
                                    dayLocked ||
                                    !canEmployeeEditBlock(b)
                                  }
                                  aria-label="Upravit blok"
                                >
                                  <Pencil className="h-5 w-5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-11 w-11 text-destructive hover:bg-red-50"
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
                                  Zakázka
                                </dt>
                                <dd className="break-words text-black">
                                  {b.jobName?.trim() || b.jobId || "—"}
                                </dd>
                              </div>
                              <div className="col-span-2">
                                <dt className="font-semibold text-black">
                                  Popis
                                </dt>
                                <dd className="break-words text-black">
                                  {getWorklogDescriptionOriginal(b) || "—"}
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
                              <TableHead className="text-black">Zakázka</TableHead>
                              <TableHead className="text-black">Popis</TableHead>
                              <TableHead className="w-24 text-black" />
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
                                <TableCell className="max-w-[140px] truncate text-sm text-black">
                                  {b.jobName?.trim() || b.jobId || "—"}
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate text-black">
                                  {getWorklogDescriptionOriginal(b) || "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-0.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-10 text-primary"
                                      onClick={() => openEdit(b)}
                                      disabled={
                                        !b.id ||
                                        dayLocked ||
                                        !canEmployeeEditBlock(b)
                                      }
                                      aria-label="Upravit"
                                    >
                                      <Pencil className="h-5 w-5" />
                                    </Button>
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
                                  </div>
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
                  <p className="text-sm text-slate-700">
                    Čas se bere z <strong>uzavřeného úseku docházkového terminálu</strong>. Bez uzavřené docházky
                    za tento den nelze přidat záznam.
                  </p>
                  <div className="space-y-2">
                    <Label
                      htmlFor="worklog-segment"
                      className="text-sm font-semibold text-black"
                    >
                      Úsek docházky <span className="text-red-600">*</span>
                    </Label>
                    <select
                      id="worklog-segment"
                      className={selectBaseClass}
                      value={newSegmentId}
                      onChange={(e) => setNewSegmentId(e.target.value)}
                      disabled={
                        dayLocked ||
                        saving ||
                        segmentsDayLoading ||
                        !workLogFeatureOn ||
                        segmentsAvailableForNewBlock.length === 0
                      }
                      aria-label="Úsek docházky"
                    >
                      <option value="">
                        {segmentsDayLoading
                          ? "Načítám úseky…"
                          : segmentsAvailableForNewBlock.length === 0
                            ? "— žádný volný uzavřený úsek —"
                            : "— vyberte úsek —"}
                      </option>
                      {segmentsAvailableForNewBlock.map((seg) => (
                        <option key={seg.id} value={seg.id}>
                          {segmentTimeRangeLabel(seg)}
                          {typeof seg.durationHours === "number"
                            ? ` (${seg.durationHours} h)`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {newSegmentId ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                      Čas bloku:{" "}
                      <span className="font-semibold tabular-nums">
                        {segmentTimeRangeLabel(
                          closedSegmentsDay.find((s) => s.id === newSegmentId) as WorkSegmentClient
                        )}
                      </span>
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    <Label
                      htmlFor="worklog-job"
                      className="text-sm font-semibold text-black"
                    >
                      Zakázka <span className="text-red-600">*</span>
                    </Label>
                    <select
                      id="worklog-job"
                      className={selectBaseClass}
                      value={newJobId}
                      onChange={(e) => setNewJobId(e.target.value)}
                      disabled={
                        dayLocked ||
                        saving ||
                        jobsLoading ||
                        assignedJobIds.length === 0 ||
                        !workLogFeatureOn
                      }
                      aria-label="Zakázka"
                    >
                      <option value="">
                        {jobsLoading
                          ? "Načítání zakázek…"
                          : assignedJobIds.length === 0
                            ? "— nemáte přiřazenou zakázku —"
                            : "— vyberte zakázku —"}
                      </option>
                      {assignedJobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name?.trim() || j.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="worklog-lang"
                      className="text-sm font-semibold text-black"
                    >
                      Jazyk popisu
                    </Label>
                    <select
                      id="worklog-lang"
                      className={selectBaseClass}
                      value={newBlockLang}
                      onChange={(e) =>
                        setNewBlockLang(e.target.value as WorklogTextLanguage)
                      }
                      disabled={dayLocked || saving}
                      aria-label="Jazyk popisu práce"
                    >
                      <option value="cs">Čeština</option>
                      <option value="ua">Українська</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="worklog-desc"
                      className="text-sm font-semibold text-black"
                    >
                      {t("workDescription")}{" "}
                      <span className="text-red-600">*</span>
                    </Label>
                    <Textarea
                      id="worklog-desc"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={3}
                      maxLength={WORKLOG_DESCRIPTION_MAX_LENGTH}
                      disabled={dayLocked || saving}
                      placeholder="Stručně popište práci v daném čase…"
                      className={cn(
                        inputBaseClass,
                        "min-h-[96px] resize-y py-3"
                      )}
                    />
                    <p className="text-xs text-slate-500">
                      Max. {WORKLOG_DESCRIPTION_MAX_LENGTH} znaků (
                      {normalizeWorklogDescription(newDesc).length}/
                      {WORKLOG_DESCRIPTION_MAX_LENGTH}).
                    </p>
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
                disabled={
                  saving ||
                  dayLocked ||
                  blocksLoading ||
                  assignedJobIds.length === 0 ||
                  !workLogFeatureOn ||
                  segmentsDayLoading ||
                  segmentsAvailableForNewBlock.length === 0 ||
                  !newSegmentId.trim()
                }
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

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditBlock(null);
        }}
      >
        <DialogContent className="max-w-lg border-slate-200 bg-white text-black">
          <DialogHeader>
            <DialogTitle>Upravit blok výkazu</DialogTitle>
            <DialogDescription className="text-slate-700">
              {editBlock?.attendanceSegmentId
                ? "Čas je vázán na úsek docházky — lze měnit zakázku a popis. U schválených záznamů kontaktujte administrátora."
                : "Změňte čas, zakázku nebo popis. U schválených záznamů kontaktujte administrátora."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <DigitalTimePair
              label="Čas od"
              valueHm={editStart}
              onChange={setEditStart}
              disabled={dayLocked || editSaving || !!editBlock?.attendanceSegmentId}
              idPrefix="edit-start"
            />
            <DigitalTimePair
              label="Čas do"
              valueHm={editEnd}
              onChange={setEditEnd}
              disabled={dayLocked || editSaving || !!editBlock?.attendanceSegmentId}
              idPrefix="edit-end"
            />
            <div className="space-y-2">
              <Label htmlFor="edit-job" className="text-black">
                Zakázka <span className="text-red-600">*</span>
              </Label>
              <select
                id="edit-job"
                className={selectBaseClass}
                value={editJobId}
                onChange={(e) => setEditJobId(e.target.value)}
                disabled={dayLocked || editSaving || jobsLoading}
              >
                <option value="">— vyberte zakázku —</option>
                {assignedJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name?.trim() || j.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-lang" className="text-black">
                Jazyk popisu
              </Label>
              <select
                id="edit-lang"
                className={selectBaseClass}
                value={editLang}
                onChange={(e) =>
                  setEditLang(e.target.value as WorklogTextLanguage)
                }
                disabled={dayLocked || editSaving}
              >
                <option value="cs">Čeština</option>
                <option value="ua">Українська</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc" className="text-black">
                {t("workDescription")}
              </Label>
              <Textarea
                id="edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                maxLength={WORKLOG_DESCRIPTION_MAX_LENGTH}
                disabled={dayLocked || editSaving}
                className={cn(
                  inputBaseClass,
                  "min-h-[96px] resize-y py-3"
                )}
              />
              <p className="text-xs text-slate-500">
                Max. {WORKLOG_DESCRIPTION_MAX_LENGTH} znaků (
                {normalizeWorklogDescription(editDesc).length}/
                {WORKLOG_DESCRIPTION_MAX_LENGTH}).
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditBlock(null);
              }}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={editSaving || dayLocked}
            >
              {editSaving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Uložit změny"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
