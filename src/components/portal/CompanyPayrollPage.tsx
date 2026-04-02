"use client";

import React, { useEffect, useMemo, useState, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
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
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import {
  formatKc,
  getLoggedHours,
  getReviewLabel,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  sumPaidAdvances,
  sumPayableHoursForBlocks,
  isWorkBlockPaid,
  type AdvanceDoc,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import { format } from "date-fns";
import type { AttendanceRow } from "@/lib/employee-attendance";
import { attendanceRowCalendarDateKey } from "@/lib/employee-attendance";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import { segmentCalendarDateIsoKey } from "@/lib/work-segment-client";
import {
  buildEmployeeDailyDetailRows,
  computePeriodRange,
  firestoreEmployeeIdMatches,
  totalsFromDailyDetailRows,
  type EmployeeLite,
} from "@/lib/attendance-overview-compute";
import { buildPayrollOverviewRows } from "@/lib/payroll-overview-compute";
import {
  dateStrInInclusiveRange,
  payrollPeriodBounds,
} from "@/lib/payroll-period";
import { PayrollPeriodPanel } from "@/components/portal/PayrollPeriodPanel";
import {
  buildWorklogPdfFileName,
  downloadWorklogPdfFromElement,
} from "@/lib/worklog-report-pdf";
import { JOB_TERMINAL_AUTO_APPROVAL_SOURCE } from "@/lib/job-terminal-auto-shared";
import {
  Loader2,
  AlertCircle,
  Check,
  Pencil,
  Trash2,
  XCircle,
  Banknote,
  Printer,
  FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getWorklogDescriptionOriginal,
  getWorklogLanguage,
} from "@/lib/worklog-description-fields";
import {
  translateToCzech,
  translateToCzechSync,
} from "@/lib/translate-to-czech";
import {
  deleteDebtAndAllPayments,
  recalculateDebtAfterPaymentsChange,
} from "@/lib/employee-debt-recalc";

const PRIV_ROLES = ["owner", "admin", "manager", "accountant"];

function debtCreatedSortMs(d: { createdAt?: unknown; date: string }): number {
  const v = d.createdAt;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (v && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      const t = (v as { toDate: () => Date }).toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t.getTime();
    } catch {
      /* ignore */
    }
  }
  const ds = String(d.date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
    const [y, m, day] = ds.split("-").map(Number);
    return new Date(y, m - 1, day, 12, 0, 0, 0).getTime();
  }
  return 0;
}

type EmployeeDebtReason = "tool_damage" | "loan" | "deduction" | "other";

type EmployeeDebtStatus = "active" | "paid" | "overpaid";

type EmployeeDebtDoc = {
  id: string;
  employeeId: string;
  companyId: string;
  amount: number;
  remainingAmount: number;
  date: string;
  note?: string;
  reason: EmployeeDebtReason;
  status: EmployeeDebtStatus;
  createdBy?: string;
  createdAt?: unknown;
};

type EmployeeDebtPaymentDoc = {
  id: string;
  debtId: string;
  employeeId: string;
  companyId: string;
  amount: number;
  date: string;
  note?: string;
  createdBy?: string;
};

function PayrollWorklogDescriptionCell({
  block,
  showCzech,
  companyId,
  firestore,
  translatingId,
  setTranslatingId,
  toast,
}: {
  block: any;
  showCzech: boolean;
  companyId: string;
  firestore: Firestore;
  translatingId: string | null;
  setTranslatingId: (id: string | null) => void;
  toast: (opts: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  }) => void;
}) {
  const orig = getWorklogDescriptionOriginal(block);
  const lang = getWorklogLanguage(block);
  const display =
    showCzech && lang === "ua"
      ? String(
          block.description_translated?.trim() || translateToCzechSync(orig)
        )
      : orig;

  const canSaveTranslation =
    showCzech &&
    lang === "ua" &&
    !String(block.description_translated ?? "").trim();

  return (
    <span className="whitespace-pre-wrap break-words">
      {String(display ?? "").trim() || "—"}
      {canSaveTranslation ? (
        <Button
          type="button"
          variant="link"
          className="block h-auto p-0 text-xs"
          disabled={translatingId === block.id}
          onClick={() => {
            setTranslatingId(block.id);
            void (async () => {
              try {
                const translated = await translateToCzech(orig);
                await updateDoc(
                  doc(
                    firestore,
                    "companies",
                    companyId,
                    "work_time_blocks",
                    block.id
                  ),
                  {
                    description_translated: translated,
                    updatedAt: serverTimestamp(),
                  }
                );
                toast({ title: "Překlad uložen" });
              } catch (e) {
                console.error(e);
                toast({
                  variant: "destructive",
                  title: "Uložení překladu se nezdařilo",
                });
              } finally {
                setTranslatingId(null);
              }
            })();
          }}
        >
          {translatingId === block.id ? "Ukládám…" : "Uložit překlad do DB"}
        </Button>
      ) : null}
    </span>
  );
}

function PayrollAdminPageInner() {
  const { user, isUserLoading } = useUser();
  const searchParams = useSearchParams();
  const employeeFromUrl = searchParams.get("employee");
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName } = useCompany();
  const worklogReportRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [showCzechTranslation, setShowCzechTranslation] = useState(false);
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const role = profile?.role || "employee";
  const canAccess = PRIV_ROLES.includes(role);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw, isLoading: employeesLoading } =
    useCollection(employeesQuery);

  const employees = useMemo(() => {
    const raw = Array.isArray(employeesRaw) ? employeesRaw : [];
    return raw.map((e: any) => ({
      ...e,
      id: String(e?.id ?? ""),
    }));
  }, [employeesRaw]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const nowInit = new Date();
  const [payrollYear, setPayrollYear] = useState(nowInit.getFullYear());
  const [payrollMonth, setPayrollMonth] = useState(nowInit.getMonth() + 1);
  const periodBounds = useMemo(
    () => payrollPeriodBounds(payrollYear, payrollMonth),
    [payrollYear, payrollMonth]
  );

  useEffect(() => {
    if (employees.length === 0) return;
    if (employeeFromUrl === "all") {
      setSelectedEmployeeId("all");
      return;
    }
    if (
      employeeFromUrl &&
      employees.some((e) => e.id === employeeFromUrl)
    ) {
      setSelectedEmployeeId(employeeFromUrl);
      return;
    }
    if (!selectedEmployeeId) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId, employeeFromUrl]);

  const blocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const { startStr, endStr } = periodBounds;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("date", ">=", startStr),
      where("date", "<=", endStr),
      orderBy("date", "desc"),
      limit(6000)
    );
  }, [firestore, companyId, periodBounds.startStr, periodBounds.endStr]);

  const { data: blocksRaw, isLoading: blocksLoading } =
    useCollection(blocksQuery);

  const advancesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !selectedEmployeeId) return null;
    if (selectedEmployeeId === "all") return null;
    return query(
      collection(firestore, "companies", companyId, "advances"),
      where("employeeId", "==", selectedEmployeeId),
      limit(200)
    );
  }, [firestore, companyId, selectedEmployeeId]);

  const { data: advancesRaw, isLoading: advancesLoading } =
    useCollection(advancesQuery);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const { startStr, endStr } = periodBounds;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("date", ">=", startStr),
      where("date", "<=", endStr),
      orderBy("date", "desc"),
      limit(6000)
    );
  }, [firestore, companyId, periodBounds.startStr, periodBounds.endStr]);

  const { data: dailyReportsRaw = [] } = useCollection(dailyReportsQuery);

  const payrollPaymentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "payroll_period_payments"),
      where("payrollPeriod", "==", periodBounds.payrollPeriod),
      limit(500)
    );
  }, [firestore, companyId, periodBounds.payrollPeriod]);

  const { data: payrollPaymentsRaw = [] } =
    useCollection(payrollPaymentsQuery);

  const attendancePayrollQuery = useMemoFirebase(() => {
    if (
      !firestore ||
      !companyId ||
      !selectedEmployeeId ||
      selectedEmployeeId === "all"
    )
      return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", selectedEmployeeId),
      limit(1000)
    );
  }, [firestore, companyId, selectedEmployeeId]);

  const workSegmentsPayrollQuery = useMemoFirebase(() => {
    if (
      !firestore ||
      !companyId ||
      !selectedEmployeeId ||
      selectedEmployeeId === "all"
    )
      return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", selectedEmployeeId),
      limit(1000)
    );
  }, [firestore, companyId, selectedEmployeeId]);

  const { data: attendancePayrollRaw = [] } =
    useCollection(attendancePayrollQuery);
  const { data: workSegmentsPayrollRaw = [] } =
    useCollection(workSegmentsPayrollQuery);

  const allBlocksInPeriod = useMemo(() => {
    const raw = Array.isArray(blocksRaw) ? blocksRaw : [];
    return raw.map((b: any) => ({
      ...b,
      id: String(b?.id ?? ""),
    })) as WorkTimeBlockMoney[];
  }, [blocksRaw]);

  const blocks = useMemo(() => {
    if (selectedEmployeeId === "all") return allBlocksInPeriod;
    if (!selectedEmployeeId) return [];
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return [];
    const lite: EmployeeLite = {
      id: String(emp.id),
      displayName:
        [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim() ||
        String(emp.email || emp.id),
      hourlyRate: Number(emp.hourlyRate) || 0,
      authUserId:
        typeof (emp as { authUserId?: string }).authUserId === "string" &&
        String((emp as { authUserId?: string }).authUserId).trim()
          ? String((emp as { authUserId?: string }).authUserId).trim()
          : undefined,
    };
    return allBlocksInPeriod.filter((b) =>
      firestoreEmployeeIdMatches(b.employeeId, lite)
    );
  }, [allBlocksInPeriod, selectedEmployeeId, employees]);

  const blocksMoney = blocks as WorkTimeBlockMoney[];

  const dailyReportsForSelected = useMemo(() => {
    const raw = Array.isArray(dailyReportsRaw) ? dailyReportsRaw : [];
    if (selectedEmployeeId === "all") return raw;
    if (!selectedEmployeeId) return [];
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return [];
    const lite: EmployeeLite = {
      id: String(emp.id),
      displayName:
        [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim() ||
        String(emp.email || emp.id),
      hourlyRate: Number(emp.hourlyRate) || 0,
      authUserId:
        typeof (emp as { authUserId?: string }).authUserId === "string" &&
        String((emp as { authUserId?: string }).authUserId).trim()
          ? String((emp as { authUserId?: string }).authUserId).trim()
          : undefined,
    };
    return raw.filter((r: Record<string, unknown>) =>
      firestoreEmployeeIdMatches(r?.employeeId, lite)
    );
  }, [dailyReportsRaw, selectedEmployeeId, employees]);

  const attendancePayrollFiltered = useMemo(() => {
    const raw = Array.isArray(attendancePayrollRaw)
      ? attendancePayrollRaw
      : [];
    return raw.filter((r) => {
      const ds = attendanceRowCalendarDateKey(r as AttendanceRow);
      return dateStrInInclusiveRange(
        ds,
        periodBounds.startStr,
        periodBounds.endStr
      );
    });
  }, [attendancePayrollRaw, periodBounds.startStr, periodBounds.endStr]);

  const workSegmentsPayrollFiltered = useMemo(() => {
    const raw = Array.isArray(workSegmentsPayrollRaw)
      ? workSegmentsPayrollRaw
      : [];
    return raw.filter((s) => {
      const dk = segmentCalendarDateIsoKey(s as WorkSegmentClient);
      return dateStrInInclusiveRange(
        dk,
        periodBounds.startStr,
        periodBounds.endStr
      );
    });
  }, [workSegmentsPayrollRaw, periodBounds.startStr, periodBounds.endStr]);

  const payrollOverviewRows = useMemo(
    () =>
      buildPayrollOverviewRows(
        employees as Record<string, unknown>[],
        allBlocksInPeriod,
        (Array.isArray(dailyReportsRaw) ? dailyReportsRaw : []) as Record<
          string,
          unknown
        >[],
        periodBounds.startStr,
        periodBounds.endStr
      ),
    [
      employees,
      allBlocksInPeriod,
      dailyReportsRaw,
      periodBounds.startStr,
      periodBounds.endStr,
    ]
  );

  const advances = useMemo((): AdvanceDoc[] => {
    const raw = Array.isArray(advancesRaw) ? advancesRaw : [];
    return raw.map((a: any) => ({
      id: String(a?.id ?? ""),
      amount: Number(a.amount) || 0,
      date: String(a.date ?? ""),
      employeeId: String(a.employeeId ?? ""),
      companyId: String(a.companyId ?? ""),
      note: a.note != null ? String(a.note) : undefined,
      status: a.status === "paid" ? "paid" : "unpaid",
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      createdBy: a.createdBy != null ? String(a.createdBy) : undefined,
    }));
  }, [advancesRaw]);

  const selectedEmp = employees.find((e) => e.id === selectedEmployeeId);
  const hourlyRate = Number(selectedEmp?.hourlyRate) || 0;
  const earnedFromDailyReports = useMemo(() => {
    return sumMoneyForApprovedDailyReports(
      dailyReportsForSelected as DailyWorkReportMoney[]
    );
  }, [dailyReportsForSelected]);
  const earnedFromBlocks = useMemo(() => {
    let s = 0;
    for (const b of blocksMoney) s += moneyForBlock(b, hourlyRate);
    return Math.round(s * 100) / 100;
  }, [blocksMoney, hourlyRate]);
  const earnedAllLegacy = useMemo(
    () =>
      Math.round((earnedFromBlocks + earnedFromDailyReports) * 100) / 100,
    [earnedFromBlocks, earnedFromDailyReports]
  );

  const earnedAllFromAttendance = useMemo(() => {
    if (selectedEmployeeId === "all" || !selectedEmp) return null;
    const rate = Number(selectedEmp.hourlyRate) || 0;
    const auRaw = (selectedEmp as { authUserId?: string }).authUserId;
    const authUserId =
      typeof auRaw === "string" && auRaw.trim() ? auRaw.trim() : null;
    const lite: EmployeeLite = {
      id: String(selectedEmp.id),
      displayName:
        [selectedEmp.firstName, selectedEmp.lastName].filter(Boolean).join(" ").trim() ||
        String(selectedEmp.email || selectedEmp.id),
      hourlyRate: rate,
      authUserId,
    };
    const anchor = new Date(`${periodBounds.startStr}T12:00:00`);
    const range = computePeriodRange("month", anchor);
    const attF = attendancePayrollFiltered as AttendanceRow[];
    const dr = dailyReportsForSelected;
    const segF = workSegmentsPayrollFiltered as WorkSegmentClient[];
    const blocksF = blocksMoney.filter((b) =>
      firestoreEmployeeIdMatches(b.employeeId, lite)
    );
    const hasAny =
      blocksF.length > 0 ||
      attF.length > 0 ||
      dr.length > 0 ||
      segF.length > 0;
    if (!hasAny) return null;
    const rows = buildEmployeeDailyDetailRows({
      range,
      employee: lite,
      attendanceRaw: attF,
      dailyReports: dr,
      workBlocks: blocksF,
      segments: segF,
    });
    return totalsFromDailyDetailRows(rows).approvedKc;
  }, [
    selectedEmployeeId,
    selectedEmp,
    blocksMoney,
    attendancePayrollFiltered,
    dailyReportsForSelected,
    workSegmentsPayrollFiltered,
    periodBounds.startStr,
  ]);

  const earnedAll = useMemo(() => {
    if (selectedEmployeeId === "all" || !selectedEmp) return earnedAllLegacy;
    if (earnedAllFromAttendance != null) return earnedAllFromAttendance;
    return earnedAllLegacy;
  }, [
    selectedEmployeeId,
    selectedEmp,
    earnedAllFromAttendance,
    earnedAllLegacy,
  ]);
  const paidTotal = sumPaidAdvances(advances);
  const remaining = Math.max(
    0,
    Math.round((earnedAll - paidTotal) * 100) / 100
  );

  const employeeLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of employees) {
      const label =
        [e.firstName, e.lastName].filter(Boolean).join(" ").trim() ||
        e.email ||
        e.id;
      m[e.id] = label;
    }
    return m;
  }, [employees]);

  const sortedBlocks = useMemo(() => {
    return [...blocksMoney].sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
  }, [blocksMoney]);

  const sortedAdvances = useMemo(() => {
    return [...advances].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
  }, [advances]);

  const sortedDailyReportsPreview = useMemo(() => {
    const raw = dailyReportsForSelected;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return [...raw].sort((a, b) =>
      String((b as Record<string, unknown>)?.date ?? "").localeCompare(
        String((a as Record<string, unknown>)?.date ?? "")
      )
    );
  }, [dailyReportsForSelected]);

  const dailyReportsHoursTotal = useMemo(() => {
    let s = 0;
    for (const r of sortedDailyReportsPreview) {
      const row = r as Record<string, unknown>;
      if (String(row?.status ?? "") !== "approved") continue;
      const h = Number(
        row?.hoursConfirmed ?? row?.hoursFromAttendance ?? row?.hoursSum ?? 0
      );
      if (Number.isFinite(h) && h > 0) s += h;
    }
    return Math.round(s * 100) / 100;
  }, [sortedDailyReportsPreview]);

  const reportEmployeeTitle =
    selectedEmployeeId === "all"
      ? "Všichni zaměstnanci"
      : employeeLabelById[selectedEmployeeId] || selectedEmployeeId || "—";

  const reportPeriodLabel = useMemo(() => {
    if (sortedBlocks.length === 0) {
      return `${periodBounds.label} — žádné bloky výkazu za toto období`;
    }
    const dates = sortedBlocks
      .map((b) => String(b.date ?? ""))
      .filter(Boolean);
    const sorted = [...dates].sort();
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    return min === max ? `Datum: ${min}` : `Rozsah dat: ${min} – ${max}`;
  }, [sortedBlocks, periodBounds.label]);

  const totalLoggedHoursSum = useMemo(() => {
    const s = sortedBlocks.reduce((acc, b) => acc + getLoggedHours(b), 0);
    return Math.round(s * 100) / 100;
  }, [sortedBlocks]);

  const totalPayableHoursSum = useMemo(
    () => Math.round(sumPayableHoursForBlocks(sortedBlocks) * 100) / 100,
    [sortedBlocks]
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
      const prefix =
        selectedEmployeeId === "all"
          ? `${companyName ?? "firma"}_vsichni`
          : `${reportEmployeeTitle}`;
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

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBlock, setReviewBlock] = useState<WorkTimeBlockMoney | null>(
    null
  );
  const [approvedHoursInput, setApprovedHoursInput] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);

  const openReview = (b: WorkTimeBlockMoney) => {
    setReviewBlock(b);
    const logged = Number(b.hours) || 0;
    const appr =
      b.approvedHours != null && !Number.isNaN(Number(b.approvedHours))
        ? Number(b.approvedHours)
        : logged;
    setApprovedHoursInput(String(appr));
    setAdminNote(String(b.adminNote ?? ""));
    setAdjustmentReason(String(b.adjustmentReason ?? ""));
    setReviewOpen(true);
  };

  const saveReview = async (quickLoggedOnly: boolean) => {
    if (!firestore || !companyId || !reviewBlock?.id || !user) return;
    const logged = Number(reviewBlock.hours) || 0;
    let appr = logged;
    if (!quickLoggedOnly) {
      const parsed = parseFloat(
        String(approvedHoursInput).replace(",", ".").trim()
      );
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({
          variant: "destructive",
          title: "Neplatné hodiny",
          description: "Zadejte nezáporné číslo (schválené hodiny).",
        });
        return;
      }
      appr = parsed;
    }
    const changed = Math.abs(appr - logged) > 0.009;
    if (changed && !adjustmentReason.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí důvod",
        description: "Při úpravě hodin oproti výkazu vyplňte zdůvodnění.",
      });
      return;
    }
    setSavingReview(true);
    try {
      const ref = doc(
        firestore,
        "companies",
        companyId,
        "work_time_blocks",
        reviewBlock.id
      );
      await updateDoc(ref, {
        approvedHours: appr,
        originalHours: reviewBlock.originalHours ?? reviewBlock.hours ?? logged,
        reviewStatus: changed ? "adjusted" : "approved",
        approved: true,
        approvedAt: serverTimestamp(),
        approvedBy: user.uid,
        approvalSource: "admin-direct",
        adminNote: adminNote.trim() || null,
        adjustmentReason: changed ? adjustmentReason.trim() : null,
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });
      toast({ title: "Uloženo", description: "Výkaz byl aktualizován." });
      setReviewOpen(false);
      setReviewBlock(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Uložení se nezdařilo.",
      });
    } finally {
      setSavingReview(false);
    }
  };

  const quickApprove = async (b: WorkTimeBlockMoney) => {
    if (!firestore || !companyId || !b.id || !user) return;
    const logged = Number(b.hours) || 0;
    try {
      const ref = doc(
        firestore,
        "companies",
        companyId,
        "work_time_blocks",
        b.id
      );
      await updateDoc(ref, {
        approvedHours: logged,
        originalHours: b.originalHours ?? b.hours ?? logged,
        reviewStatus: "approved",
        approved: true,
        approvedAt: serverTimestamp(),
        approvedBy: user.uid,
        approvalSource: "admin-direct",
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });
      toast({ title: "Schváleno", description: "Hodiny odpovídají výkazu." });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const quickUnapprove = async (b: WorkTimeBlockMoney) => {
    if (!firestore || !companyId || !b.id || !user) return;
    try {
      const ref = doc(firestore, "companies", companyId, "work_time_blocks", b.id);
      await updateDoc(ref, {
        reviewStatus: "pending",
        approved: false,
        approvedHours: null,
        approvedAt: null,
        approvedBy: null,
        approvalSource: "admin-direct",
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Schválení zrušeno" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const toggleBlockPaid = async (b: WorkTimeBlockMoney, nextPaid?: boolean) => {
    if (!firestore || !companyId || !b.id || !user) return;
    const paid = nextPaid ?? !isWorkBlockPaid(b);
    try {
      const ref = doc(firestore, "companies", companyId, "work_time_blocks", b.id);
      await updateDoc(ref, {
        paid,
        paidAt: paid ? serverTimestamp() : null,
        paidBy: paid ? user.uid : null,
        updatedAt: serverTimestamp(),
      });
      toast({ title: paid ? "Označeno jako zaplaceno" : "Označeno jako nezaplaceno" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const applyBulkOnBlocks = async (
    mode: "approve" | "unapprove" | "paid" | "unpaid"
  ) => {
    if (!firestore || !companyId || !user || selectedBlockIds.length === 0) return;
    const targets = sortedBlocks.filter((b) => b.id && selectedBlockIds.includes(String(b.id)));
    if (targets.length === 0) return;
    try {
      await Promise.all(
        targets.map((b) => {
          const ref = doc(firestore, "companies", companyId, "work_time_blocks", String(b.id));
          if (mode === "approve") {
            const logged = Number(b.hours) || 0;
            return updateDoc(ref, {
              approvedHours: logged,
              originalHours: b.originalHours ?? b.hours ?? logged,
              reviewStatus: "approved",
              approved: true,
              approvedAt: serverTimestamp(),
              approvedBy: user.uid,
              approvalSource: "admin-direct",
              updatedAt: serverTimestamp(),
              reviewedAt: serverTimestamp(),
              reviewedBy: user.uid,
            });
          }
          if (mode === "unapprove") {
            return updateDoc(ref, {
              reviewStatus: "pending",
              approved: false,
              approvedHours: null,
              approvedAt: null,
              approvedBy: null,
              approvalSource: "admin-direct",
              updatedAt: serverTimestamp(),
              reviewedAt: serverTimestamp(),
              reviewedBy: user.uid,
            });
          }
          if (mode === "paid") {
            return updateDoc(ref, {
              paid: true,
              paidAt: serverTimestamp(),
              paidBy: user.uid,
              updatedAt: serverTimestamp(),
            });
          }
          return updateDoc(ref, {
            paid: false,
            paidAt: null,
            paidBy: null,
            updatedAt: serverTimestamp(),
          });
        })
      );
      toast({ title: "Hromadná změna byla uložena" });
      setSelectedBlockIds([]);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Hromadná změna selhala" });
    }
  };

  const [newAdvanceAmount, setNewAdvanceAmount] = useState("");
  const [newAdvanceDate, setNewAdvanceDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [newAdvanceNote, setNewAdvanceNote] = useState("");
  const [newAdvanceStatus, setNewAdvanceStatus] = useState<"paid" | "unpaid">(
    "unpaid"
  );
  const [savingAdvance, setSavingAdvance] = useState(false);

  const addAdvance = async () => {
    if (!firestore || !companyId || !selectedEmployeeId || !user) return;
    const amt = parseFloat(newAdvanceAmount.replace(",", ".").trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatná částka",
      });
      return;
    }
    setSavingAdvance(true);
    try {
      await addDoc(collection(firestore, "companies", companyId, "advances"), {
        amount: amt,
        date: newAdvanceDate,
        employeeId: selectedEmployeeId,
        companyId,
        note: newAdvanceNote.trim() || "",
        status: newAdvanceStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
      });
      toast({ title: "Záloha přidána" });
      setNewAdvanceAmount("");
      setNewAdvanceNote("");
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba ukládání" });
    } finally {
      setSavingAdvance(false);
    }
  };

  const toggleAdvancePaid = async (a: AdvanceDoc) => {
    if (!firestore || !companyId || !a.id) return;
    const next = a.status === "paid" ? "unpaid" : "paid";
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "advances", a.id),
        {
          status: next,
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: next === "paid" ? "Označeno jako zaplaceno" : "Označeno jako nezaplaceno",
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const deleteAdvance = async (a: AdvanceDoc) => {
    if (!firestore || !companyId || !a.id) return;
    if (!confirm("Smazat tuto zálohu?")) return;
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "advances", a.id));
      toast({ title: "Smazáno" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Smazání se nezdařilo" });
    }
  };

  const [advanceEditOpen, setAdvanceEditOpen] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<AdvanceDoc | null>(null);
  const [editAdvAmount, setEditAdvAmount] = useState("");
  const [editAdvDate, setEditAdvDate] = useState("");
  const [editAdvNote, setEditAdvNote] = useState("");
  const [editAdvStatus, setEditAdvStatus] = useState<"paid" | "unpaid">(
    "unpaid"
  );
  const [savingAdvEdit, setSavingAdvEdit] = useState(false);

  const openAdvanceEdit = (a: AdvanceDoc) => {
    setEditingAdvance(a);
    setEditAdvAmount(String(a.amount));
    setEditAdvDate(a.date || new Date().toISOString().split("T")[0]);
    setEditAdvNote(a.note || "");
    setEditAdvStatus(a.status);
    setAdvanceEditOpen(true);
  };

  const saveAdvanceEdit = async () => {
    if (!firestore || !companyId || !editingAdvance?.id) return;
    const amt = parseFloat(editAdvAmount.replace(",", ".").trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ variant: "destructive", title: "Neplatná částka" });
      return;
    }
    setSavingAdvEdit(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "advances", editingAdvance.id),
        {
          amount: amt,
          date: editAdvDate,
          note: editAdvNote.trim() || "",
          status: editAdvStatus,
          updatedAt: serverTimestamp(),
        }
      );
      toast({ title: "Záloha uložena" });
      setAdvanceEditOpen(false);
      setEditingAdvance(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba ukládání" });
    } finally {
      setSavingAdvEdit(false);
    }
  };

  const debtsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !selectedEmployeeId || selectedEmployeeId === "all") return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debts"),
      where("employeeId", "==", selectedEmployeeId),
      limit(300)
    );
  }, [firestore, companyId, selectedEmployeeId]);
  const debtPaymentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !selectedEmployeeId || selectedEmployeeId === "all") return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debt_payments"),
      where("employeeId", "==", selectedEmployeeId),
      limit(500)
    );
  }, [firestore, companyId, selectedEmployeeId]);
  const { data: debtsRaw = [] } = useCollection(debtsQuery);
  const { data: debtPaymentsRaw = [] } = useCollection(debtPaymentsQuery);
  const debts = useMemo((): EmployeeDebtDoc[] => {
    const raw = Array.isArray(debtsRaw) ? debtsRaw : [];
    return raw
      .map((d: any) => ({
        id: String(d?.id ?? ""),
        employeeId: String(d?.employeeId ?? ""),
        companyId: String(d?.companyId ?? ""),
        amount: Number(d?.amount) || 0,
        remainingAmount: Number(d?.remainingAmount) || 0,
        date: String(d?.date ?? ""),
        note: d?.note != null ? String(d.note) : "",
        reason: (["tool_damage", "loan", "deduction", "other"].includes(String(d?.reason))
          ? String(d?.reason)
          : "other") as EmployeeDebtReason,
        status: (() => {
          const rem = Number(d?.remainingAmount) || 0;
          if (rem < 0) return "overpaid" as const;
          if (rem > 0) return "active" as const;
          const st = String(d?.status ?? "");
          if (st === "overpaid") return "overpaid" as const;
          return "paid" as const;
        })(),
        createdBy: d?.createdBy != null ? String(d.createdBy) : undefined,
        createdAt: d?.createdAt,
      }))
      .sort((a, b) => {
        const ma = debtCreatedSortMs(a);
        const mb = debtCreatedSortMs(b);
        if (mb !== ma) return mb - ma;
        return String(b.date).localeCompare(String(a.date));
      });
  }, [debtsRaw]);
  const debtPayments = useMemo((): EmployeeDebtPaymentDoc[] => {
    const raw = Array.isArray(debtPaymentsRaw) ? debtPaymentsRaw : [];
    return raw
      .map((p: any) => ({
        id: String(p?.id ?? ""),
        debtId: String(p?.debtId ?? ""),
        employeeId: String(p?.employeeId ?? ""),
        companyId: String(p?.companyId ?? ""),
        amount: Number(p?.amount) || 0,
        date: String(p?.date ?? ""),
        note: p?.note != null ? String(p.note) : "",
        createdBy: p?.createdBy != null ? String(p.createdBy) : undefined,
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [debtPaymentsRaw]);
  const [newDebtAmount, setNewDebtAmount] = useState("");
  const [newDebtDate, setNewDebtDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [newDebtReason, setNewDebtReason] = useState<EmployeeDebtReason>("other");
  const [newDebtNote, setNewDebtNote] = useState("");
  const [savingDebt, setSavingDebt] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDebtId, setPaymentDebtId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [paymentNote, setPaymentNote] = useState("");
  const [editingPayment, setEditingPayment] = useState<EmployeeDebtPaymentDoc | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  const [debtEditOpen, setDebtEditOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<EmployeeDebtDoc | null>(null);
  const [editDebtAmount, setEditDebtAmount] = useState("");
  const [editDebtDate, setEditDebtDate] = useState("");
  const [editDebtReason, setEditDebtReason] = useState<EmployeeDebtReason>("other");
  const [editDebtNote, setEditDebtNote] = useState("");
  const [savingDebtEdit, setSavingDebtEdit] = useState(false);

  const [debtDeleteOpen, setDebtDeleteOpen] = useState(false);
  const [debtToDelete, setDebtToDelete] = useState<EmployeeDebtDoc | null>(null);
  const [deletingDebt, setDeletingDebt] = useState(false);

  const [paymentDeleteOpen, setPaymentDeleteOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<EmployeeDebtPaymentDoc | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const addDebt = async () => {
    if (!firestore || !companyId || !selectedEmployeeId || !user || selectedEmployeeId === "all") return;
    const amount = Number(String(newDebtAmount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ variant: "destructive", title: "Neplatná částka dluhu" });
      return;
    }
    setSavingDebt(true);
    try {
      await addDoc(collection(firestore, "companies", companyId, "employee_debts"), {
        companyId,
        employeeId: selectedEmployeeId,
        amount,
        remainingAmount: amount,
        date: newDebtDate,
        reason: newDebtReason,
        note: newDebtNote.trim() || "",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        createdBy: user.uid,
      });
      toast({ title: "Dluh byl přidán" });
      setNewDebtAmount("");
      setNewDebtNote("");
      setNewDebtReason("other");
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení dluhu selhalo" });
    } finally {
      setSavingDebt(false);
    }
  };
  const openDebtPayment = (debtId: string) => {
    setEditingPayment(null);
    setPaymentDebtId(debtId);
    setPaymentAmount("");
    setPaymentNote("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentOpen(true);
  };

  const openPaymentEdit = (p: EmployeeDebtPaymentDoc) => {
    setEditingPayment(p);
    setPaymentDebtId(p.debtId);
    setPaymentAmount(String(p.amount));
    setPaymentDate(p.date || new Date().toISOString().split("T")[0]);
    setPaymentNote(p.note || "");
    setPaymentOpen(true);
  };

  const saveDebtPayment = async () => {
    if (!firestore || !companyId || !selectedEmployeeId || !user || !paymentDebtId) return;
    const amount = Number(String(paymentAmount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ variant: "destructive", title: "Neplatná částka splátky" });
      return;
    }
    setSavingPayment(true);
    try {
      if (editingPayment?.id) {
        await updateDoc(
          doc(firestore, "companies", companyId, "employee_debt_payments", editingPayment.id),
          {
            amount,
            date: paymentDate,
            note: paymentNote.trim() || "",
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
          }
        );
        toast({ title: "Splátka byla uložena" });
      } else {
        await addDoc(collection(firestore, "companies", companyId, "employee_debt_payments"), {
          companyId,
          employeeId: selectedEmployeeId,
          debtId: paymentDebtId,
          amount,
          date: paymentDate,
          note: paymentNote.trim() || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
          updatedBy: user.uid,
        });
        toast({ title: "Splátka byla přidána" });
      }
      await recalculateDebtAfterPaymentsChange(firestore, companyId, paymentDebtId, user.uid);
      setPaymentOpen(false);
      setPaymentDebtId("");
      setEditingPayment(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení splátky selhalo" });
    } finally {
      setSavingPayment(false);
    }
  };

  const confirmDeletePayment = async () => {
    if (!firestore || !companyId || !user || !paymentToDelete?.id || !paymentToDelete.debtId) return;
    setDeletingPayment(true);
    try {
      await deleteDoc(
        doc(firestore, "companies", companyId, "employee_debt_payments", paymentToDelete.id)
      );
      await recalculateDebtAfterPaymentsChange(
        firestore,
        companyId,
        paymentToDelete.debtId,
        user.uid
      );
      toast({ title: "Splátka byla smazána" });
      setPaymentDeleteOpen(false);
      setPaymentToDelete(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Smazání splátky selhalo" });
    } finally {
      setDeletingPayment(false);
    }
  };

  const openDebtEdit = (d: EmployeeDebtDoc) => {
    setEditingDebt(d);
    setEditDebtAmount(String(d.amount));
    setEditDebtDate(d.date || new Date().toISOString().split("T")[0]);
    setEditDebtReason(d.reason);
    setEditDebtNote(d.note || "");
    setDebtEditOpen(true);
  };

  const saveDebtEdit = async () => {
    if (!firestore || !companyId || !user || !editingDebt?.id) return;
    const amount = Number(String(editDebtAmount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ variant: "destructive", title: "Neplatná částka dluhu" });
      return;
    }
    setSavingDebtEdit(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "employee_debts", editingDebt.id), {
        amount,
        date: editDebtDate,
        reason: editDebtReason,
        note: editDebtNote.trim() || "",
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await recalculateDebtAfterPaymentsChange(firestore, companyId, editingDebt.id, user.uid);
      toast({ title: "Dluh byl uložen" });
      setDebtEditOpen(false);
      setEditingDebt(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení dluhu selhalo" });
    } finally {
      setSavingDebtEdit(false);
    }
  };

  const confirmDeleteDebt = async () => {
    if (!firestore || !companyId || !debtToDelete?.id) return;
    setDeletingDebt(true);
    try {
      await deleteDebtAndAllPayments(firestore, companyId, debtToDelete.id);
      toast({ title: "Dluh a navázané splátky byly smazány" });
      setDebtDeleteOpen(false);
      setDebtToDelete(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Smazání dluhu selhalo" });
    } finally {
      setDeletingDebt(false);
    }
  };
  const debtTotals = useMemo(() => {
    const totalDebt = debts.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const remainingDebt = debts.reduce((s, d) => s + (Number(d.remainingAmount) || 0), 0);
    const repaidDebt = Math.max(0, Math.round((totalDebt - remainingDebt) * 100) / 100);
    return {
      totalDebt: Math.round(totalDebt * 100) / 100,
      remainingDebt: Math.round(remainingDebt * 100) / 100,
      repaidDebt,
    };
  }, [debts]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-black">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-black">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Načítání…</span>
      </div>
    );
  }

  if (!canAccess || !companyId) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Přístup zamítnut</AlertTitle>
        <AlertDescription>
          Tuto sekci mohou používat jen oprávněné role ve firmě.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-2 pb-12 print:max-w-none sm:px-4">
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Banknote className="mt-1 h-8 w-8 shrink-0 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-black sm:text-3xl">
              Výplaty a výkazy
            </h1>
            <p className="text-base text-slate-800">
              Schvalování výkazu práce a správa záloh zaměstnance.
            </p>
          </div>
        </div>
      </div>

      <Card className="border-slate-200 bg-white print:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-black">Zaměstnanec</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-black">Vyberte zaměstnance</Label>
              <select
                className={cn(
                  "h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-medium text-black",
                  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                )}
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                disabled={employeesLoading || employees.length === 0}
              >
                {employees.length === 0 ? (
                  <option value="">— žádní zaměstnanci —</option>
                ) : (
                  <>
                    <option value="all">Všichni zaměstnanci (výkazy)</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {[e.firstName, e.lastName].filter(Boolean).join(" ") ||
                          e.email ||
                          e.id}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-black">Rok</Label>
              <select
                className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-medium text-black"
                value={payrollYear}
                onChange={(e) => setPayrollYear(Number(e.target.value))}
              >
                {Array.from(
                  { length: 14 },
                  (_, i) => new Date().getFullYear() - 6 + i
                ).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-black">Měsíc</Label>
              <select
                className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-medium text-black"
                value={payrollMonth}
                onChange={(e) => setPayrollMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Výkazy a mzdy za období:{" "}
            <span className="font-semibold text-slate-800">
              {periodBounds.label}
            </span>
            .
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {selectedEmp && selectedEmployeeId !== "all" && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black">
              <p>
                <span className="font-semibold">Sazba:</span>{" "}
                {hourlyRate > 0 ? `${hourlyRate} Kč/h` : "není nastavena"}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Vyděláno (schv.):</span>{" "}
                {formatKc(earnedAll)}
              </p>
              <p className="text-xs text-slate-800">
                Bloky výkazu: {formatKc(earnedFromBlocks)} · Denní výkazy (schv.):{" "}
                {formatKc(earnedFromDailyReports)}
              </p>
              <p>
                <span className="font-semibold">Vyplaceno:</span>{" "}
                {formatKc(paidTotal)}
              </p>
              <p className="font-bold text-emerald-900">
                Zbývá: {formatKc(remaining)}
              </p>
            </div>
          )}
          {selectedEmployeeId === "all" && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black">
              <p className="font-medium">
                Zobrazují se výkazy všech zaměstnanců. Pro výpočet mezd a záloh
                vyberte konkrétního zaměstnance.
              </p>
            </div>
          )}
          </div>
        </CardContent>
      </Card>

      {companyId ? (
        <PayrollPeriodPanel
          firestore={firestore}
          companyId={companyId}
          userId={user?.uid}
          payrollPeriod={periodBounds.payrollPeriod}
          periodLabel={periodBounds.label}
          overviewRows={payrollOverviewRows}
          paymentRaw={payrollPaymentsRaw ?? []}
          toast={toast}
        />
      ) : null}

      {!selectedEmployeeId ? (
        <p className="text-black">Vyberte zaměstnance.</p>
      ) : selectedEmployeeId === "all" ? (
        <Tabs defaultValue="worklogs" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-slate-100 p-1 print:hidden sm:max-w-md">
            <TabsTrigger
              value="worklogs"
              className="min-h-[48px] text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-black"
            >
              Výkazy (všichni)
            </TabsTrigger>
          </TabsList>
          <TabsContent value="worklogs" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-black"
                disabled={blocksLoading || sortedBlocks.length === 0}
                onClick={handlePrintWorklog}
              >
                <Printer className="mr-2 h-4 w-4" />
                Tisk
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-black"
                disabled={
                  blocksLoading || sortedBlocks.length === 0 || pdfExporting
                }
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
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <Switch
                id="payroll-translate-all"
                checked={showCzechTranslation}
                onCheckedChange={setShowCzechTranslation}
              />
              <Label
                htmlFor="payroll-translate-all"
                className="cursor-pointer text-sm font-medium text-black"
              >
                Přeložit do češtiny (ukrajinské popisy)
              </Label>
            </div>
            <div ref={worklogReportRef} className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-black print:border-0 print:bg-white print:p-0">
                <h2 className="text-xl font-bold tracking-tight">
                  Pracovní výkaz
                </h2>
                {companyName ? (
                  <p className="mt-1 text-sm text-slate-700">{companyName}</p>
                ) : null}
                <p className="mt-1 text-sm font-medium">{reportEmployeeTitle}</p>
                <p className="mt-1 text-xs text-slate-800">{reportPeriodLabel}</p>
                <p className="mt-3 text-sm">
                  Součty: výkaz {totalLoggedHoursSum} h · schválený čas (započitatelné){" "}
                  {totalPayableHoursSum} h
                </p>
                <p className="mt-1 text-sm">
                  Zaplaceno:{" "}
                  {
                    sortedBlocks.filter((b) => isWorkBlockPaid(b)).length
                  }{" "}
                  / {sortedBlocks.length} záznamů
                </p>
              </div>
              <Card className="border-slate-200 bg-white print:border-0 print:shadow-none">
                <CardHeader className="print:hidden">
                  <CardTitle className="text-lg text-black">
                    Výkaz práce — přehled firmy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {blocksLoading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : sortedBlocks.length === 0 ? (
                    <p className="text-black">Žádné bloky.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200 print:border-slate-300">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-black">Zaměstnanec</TableHead>
                            <TableHead className="text-black">Datum</TableHead>
                            <TableHead className="text-black">Čas</TableHead>
                            <TableHead className="text-black">Zakázka</TableHead>
                            <TableHead className="min-w-[200px] max-w-[320px] text-black">
                              Popis práce
                            </TableHead>
                            <TableHead className="text-black">Výkaz h</TableHead>
                            <TableHead className="text-black">Schv. h</TableHead>
                            <TableHead className="text-black">Stav</TableHead>
                            <TableHead className="print:hidden">Akce</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedBlocks.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="text-black">
                                {b.employeeName?.trim() ||
                                  employeeLabelById[String(b.employeeId ?? "")] ||
                                  b.employeeId ||
                                  "—"}
                              </TableCell>
                              <TableCell className="font-medium text-black">
                                {b.date}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-black">
                                {b.startTime}–{b.endTime}
                              </TableCell>
                              <TableCell className="max-w-[160px] align-top text-black">
                                <span className="line-clamp-4 break-words print:line-clamp-none">
                                  {b.jobName?.trim() || b.jobId || "—"}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-[320px] align-top text-sm text-black">
                                {companyId ? (
                                  <PayrollWorklogDescriptionCell
                                    block={b}
                                    showCzech={showCzechTranslation}
                                    companyId={companyId}
                                    firestore={firestore}
                                    translatingId={translatingId}
                                    setTranslatingId={setTranslatingId}
                                    toast={toast}
                                  />
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="text-black">
                                {b.hours ?? "—"}
                              </TableCell>
                              <TableCell className="text-black">
                                {b.reviewStatus === "pending"
                                  ? "—"
                                  : (b.approvedHours ?? b.hours ?? "—")}
                              </TableCell>
                              <TableCell className="text-black">
                                {getReviewLabel(b.reviewStatus)}
                              </TableCell>
                              <TableCell className="print:hidden">
                                <div className="flex flex-wrap gap-2">
                                  {b.reviewStatus === "pending" && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="default"
                                      onClick={() => quickApprove(b)}
                                    >
                                      <Check className="mr-1 h-4 w-4" />
                                      Schválit
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-slate-300 text-black"
                                    onClick={() => openReview(b)}
                                  >
                                    <Pencil className="mr-1 h-4 w-4" />
                                    Úprava
                                  </Button>
                                </div>
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
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="worklogs" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-slate-100 p-1 print:hidden sm:max-w-xl">
            <TabsTrigger
              value="worklogs"
              className="min-h-[48px] text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-black"
            >
              Výkazy
            </TabsTrigger>
            <TabsTrigger
              value="advances"
              className="min-h-[48px] text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-black"
            >
              Zálohy
            </TabsTrigger>
            <TabsTrigger
              value="debts"
              className="min-h-[48px] text-base font-semibold data-[state=active]:bg-white data-[state=active]:text-black"
            >
              Dluhy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="worklogs" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-black"
                disabled={blocksLoading || sortedBlocks.length === 0}
                onClick={handlePrintWorklog}
              >
                <Printer className="mr-2 h-4 w-4" />
                Tisk
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-slate-300 text-black"
                disabled={
                  blocksLoading || sortedBlocks.length === 0 || pdfExporting
                }
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
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <Switch
                id="payroll-translate-one"
                checked={showCzechTranslation}
                onCheckedChange={setShowCzechTranslation}
              />
              <Label
                htmlFor="payroll-translate-one"
                className="cursor-pointer text-sm font-medium text-black"
              >
                Přeložit do češtiny (ukrajinské popisy)
              </Label>
            </div>
            <div ref={worklogReportRef} className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-black print:border-0 print:bg-white print:p-0">
                <h2 className="text-xl font-bold tracking-tight">
                  Pracovní výkaz
                </h2>
                {companyName ? (
                  <p className="mt-1 text-sm text-slate-700">{companyName}</p>
                ) : null}
                <p className="mt-1 text-sm font-medium">{reportEmployeeTitle}</p>
                <p className="mt-1 text-xs text-slate-800">{reportPeriodLabel}</p>
                <p className="mt-3 text-sm">
                  Součty: výkaz {totalLoggedHoursSum} h · schválený čas (započitatelné){" "}
                  {totalPayableHoursSum} h
                </p>
              </div>
              <Card className="border-slate-200 bg-white print:border-0 print:shadow-none">
                <CardHeader className="print:hidden">
                  <CardTitle className="text-lg text-black">
                    Výkaz práce — kontrola
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {blocksLoading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : sortedBlocks.length === 0 ? (
                    <p className="text-black">Žádné bloky.</p>
                  ) : (
                    <>
                    <div className="mb-3 flex flex-wrap gap-2 print:hidden">
                      <Button type="button" size="sm" variant="outline" onClick={() => applyBulkOnBlocks("approve")} disabled={selectedBlockIds.length === 0}>
                        Schválit vybrané
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => applyBulkOnBlocks("unapprove")} disabled={selectedBlockIds.length === 0}>
                        Zrušit schválení
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="border-emerald-700 text-emerald-700" onClick={() => applyBulkOnBlocks("paid")} disabled={selectedBlockIds.length === 0}>
                        Označit zaplaceno
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="border-rose-700 text-rose-700" onClick={() => applyBulkOnBlocks("unpaid")} disabled={selectedBlockIds.length === 0}>
                        Označit nezaplaceno
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-md border border-slate-200 print:border-slate-300">
                      <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[40px] print:hidden">
                                <Checkbox
                                  checked={selectedBlockIds.length > 0 && selectedBlockIds.length === sortedBlocks.length}
                                  onCheckedChange={(v) =>
                                    setSelectedBlockIds(v ? sortedBlocks.map((b) => String(b.id ?? "")).filter(Boolean) : [])
                                  }
                                  aria-label="Vybrat vše"
                                />
                              </TableHead>
                              <TableHead className="text-black">Datum</TableHead>
                              <TableHead className="text-black">Čas</TableHead>
                              <TableHead className="text-black">Zakázka</TableHead>
                              <TableHead className="min-w-[200px] max-w-[320px] text-black">
                                Popis práce
                              </TableHead>
                              <TableHead className="text-black">Výkaz h</TableHead>
                              <TableHead className="text-black">Schv. h</TableHead>
                              <TableHead className="text-black">Stav</TableHead>
                              <TableHead className="text-black">Platba</TableHead>
                              <TableHead className="print:hidden">Akce</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedBlocks.map((b) => (
                              <TableRow key={b.id}>
                                <TableCell className="print:hidden">
                                  <Checkbox
                                    checked={selectedBlockIds.includes(String(b.id ?? ""))}
                                    onCheckedChange={(v) => {
                                      const id = String(b.id ?? "");
                                      if (!id) return;
                                      setSelectedBlockIds((prev) =>
                                        v ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)
                                      );
                                    }}
                                    aria-label={`Vybrat ${b.date}`}
                                  />
                                </TableCell>
                                <TableCell className="font-medium text-black">
                                  {b.date}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-black">
                                  {b.startTime}–{b.endTime}
                                </TableCell>
                                <TableCell className="max-w-[160px] align-top text-black">
                                  <span className="line-clamp-4 break-words print:line-clamp-none">
                                    {b.jobName?.trim() || b.jobId || "—"}
                                  </span>
                                </TableCell>
                                <TableCell className="max-w-[320px] align-top text-sm text-black">
                                  {companyId ? (
                                    <PayrollWorklogDescriptionCell
                                      block={b}
                                      showCzech={showCzechTranslation}
                                      companyId={companyId}
                                      firestore={firestore}
                                      translatingId={translatingId}
                                      setTranslatingId={setTranslatingId}
                                      toast={toast}
                                    />
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell className="text-black">
                                  {b.hours ?? "—"}
                                </TableCell>
                                <TableCell className="text-black">
                                  {b.reviewStatus === "pending"
                                    ? "—"
                                    : (b.approvedHours ?? b.hours ?? "—")}
                                </TableCell>
                                <TableCell className="text-black">
                                  <span className="inline-flex flex-col gap-1">
                                    <span>{getReviewLabel(b.reviewStatus)}</span>
                                    {b.approvedAutomatically === true &&
                                    String(b.approvalSource ?? "") === JOB_TERMINAL_AUTO_APPROVAL_SOURCE ? (
                                      <Badge variant="outline" className="w-fit text-xs font-normal">
                                        Automaticky schváleno
                                      </Badge>
                                    ) : null}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Badge className={isWorkBlockPaid(b) ? "bg-emerald-600 text-white hover:bg-emerald-600" : "bg-slate-200 text-black hover:bg-slate-200"}>
                                    {isWorkBlockPaid(b) ? "Zaplaceno" : "Nezaplaceno"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="print:hidden">
                                  <div className="flex flex-wrap gap-2">
                                    {b.reviewStatus === "pending" && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="default"
                                        onClick={() => quickApprove(b)}
                                      >
                                        <Check className="mr-1 h-4 w-4" />
                                        Schválit
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="border-slate-300 text-black"
                                      onClick={() => openReview(b)}
                                    >
                                      <Pencil className="mr-1 h-4 w-4" />
                                      Úprava
                                    </Button>
                                    {b.reviewStatus !== "pending" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="border-amber-500 text-amber-700"
                                        onClick={() => quickUnapprove(b)}
                                      >
                                        Zrušit schválení
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isWorkBlockPaid(b) ? "destructive" : "default"}
                                      onClick={() => toggleBlockPaid(b)}
                                    >
                                      {isWorkBlockPaid(b) ? "Nezaplaceno" : "Zaplaceno"}
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
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white print:border-0 print:shadow-none">
                <CardHeader className="print:hidden">
                  <CardTitle className="text-lg text-black">
                    Denní výkazy (za {periodBounds.label})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {sortedDailyReportsPreview.length === 0 ? (
                    <p className="text-sm text-slate-700">
                      Za zvolené období nejsou evidované denní výkazy, nebo nejsou
                      přiřazeny k tomuto zaměstnanci.
                    </p>
                  ) : (
                    <>
                      <p className="mb-3 text-sm text-black">
                        Součet schválených hodin z denních výkazů:{" "}
                        <span className="font-semibold tabular-nums">
                          {dailyReportsHoursTotal} h
                        </span>
                        {" · "}
                        schválená částka:{" "}
                        <span className="font-semibold">
                          {formatKc(earnedFromDailyReports)}
                        </span>
                      </p>
                      <div className="overflow-x-auto rounded-md border border-slate-200">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-black">Datum</TableHead>
                              <TableHead className="text-black">Hodiny</TableHead>
                              <TableHead className="text-black">Zakázka / práce</TableHead>
                              <TableHead className="text-black">Poznámka</TableHead>
                              <TableHead className="text-black">Stav</TableHead>
                              <TableHead className="text-black">Částka</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedDailyReportsPreview.map((raw) => {
                              const r = raw as Record<string, unknown>;
                              const id = String(r?.id ?? "");
                              const hours = Number(
                                r?.hoursConfirmed ??
                                  r?.hoursFromAttendance ??
                                  r?.hoursSum ??
                                  0
                              );
                              const st = String(r?.status ?? "");
                              const job =
                                String(r?.primaryJobName ?? "").trim() ||
                                String(r?.primaryJobId ?? "").trim() ||
                                "—";
                              const note = String(r?.note ?? "").trim() || "—";
                              const amt = Number(r?.payableAmountCzk);
                              return (
                                <TableRow
                                  key={
                                    id ||
                                    `${String(r?.date ?? "")}-${String(r?.status ?? "")}`
                                  }
                                >
                                  <TableCell className="whitespace-nowrap font-medium text-black">
                                    {String(r?.date ?? "").slice(0, 10) || "—"}
                                  </TableCell>
                                  <TableCell className="tabular-nums text-black">
                                    {Number.isFinite(hours) && hours > 0
                                      ? hours
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="max-w-[200px] text-sm text-black">
                                    {job}
                                  </TableCell>
                                  <TableCell className="max-w-[240px] whitespace-pre-wrap text-sm text-black">
                                    {note}
                                  </TableCell>
                                  <TableCell className="text-black">
                                    {st === "approved"
                                      ? "Schváleno"
                                      : st === "pending"
                                        ? "Čeká"
                                        : st === "rejected"
                                          ? "Zamítnuto"
                                          : st || "—"}
                                  </TableCell>
                                  <TableCell className="tabular-nums text-black">
                                    {st === "approved" &&
                                    Number.isFinite(amt) &&
                                    amt > 0
                                      ? formatKc(amt)
                                      : "—"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="advances" className="mt-4 space-y-4">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-lg text-black">Nová záloha</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-black">Částka (Kč)</Label>
                  <Input
                    className="h-12 border-slate-300 bg-white text-base text-black"
                    value={newAdvanceAmount}
                    onChange={(e) => setNewAdvanceAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="např. 5000"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-black">Datum</Label>
                  <Input
                    type="date"
                    className="h-12 border-slate-300 bg-white text-base text-black"
                    value={newAdvanceDate}
                    onChange={(e) => setNewAdvanceDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-black">Poznámka</Label>
                  <Textarea
                    className="min-h-[80px] border-slate-300 bg-white text-base text-black"
                    value={newAdvanceNote}
                    onChange={(e) => setNewAdvanceNote(e.target.value)}
                    placeholder="Volitelná poznámka…"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-black">Stav při vytvoření</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={newAdvanceStatus === "unpaid" ? "default" : "outline"}
                      className="min-h-[48px] flex-1"
                      onClick={() => setNewAdvanceStatus("unpaid")}
                    >
                      Nezaplaceno
                    </Button>
                    <Button
                      type="button"
                      variant={newAdvanceStatus === "paid" ? "default" : "outline"}
                      className="min-h-[48px] flex-1 bg-emerald-600 hover:bg-emerald-600"
                      onClick={() => setNewAdvanceStatus("paid")}
                    >
                      Zaplaceno
                    </Button>
                  </div>
                </div>
                <div className="flex items-end sm:col-span-2">
                  <Button
                    type="button"
                    className="h-12 w-full min-h-[48px] text-base sm:w-auto"
                    onClick={addAdvance}
                    disabled={savingAdvance}
                  >
                    {savingAdvance ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Přidat zálohu"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-lg text-black">
                  Evidence záloh
                </CardTitle>
              </CardHeader>
              <CardContent>
                {advancesLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : sortedAdvances.length === 0 ? (
                  <p className="text-black">Žádné zálohy.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3 md:hidden">
                      {sortedAdvances.map((a) => (
                        <li
                          key={a.id}
                          className="rounded-lg border border-slate-300 p-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-lg font-bold text-black">
                              {formatKc(a.amount)}
                            </span>
                            <Button
                              type="button"
                              size="lg"
                              className={cn(
                                "min-h-[48px] flex-1 font-semibold",
                                a.status === "paid"
                                  ? "bg-red-600 hover:bg-red-600"
                                  : "bg-emerald-600 hover:bg-emerald-600"
                              )}
                              onClick={() => toggleAdvancePaid(a)}
                            >
                              {a.status === "paid" ? (
                                <>
                                  <XCircle className="mr-2 h-5 w-5" />
                                  Nezaplaceno
                                </>
                              ) : (
                                <>
                                  <Check className="mr-2 h-5 w-5" />
                                  Zaplaceno
                                </>
                              )}
                            </Button>
                          </div>
                          <p className="mt-2 text-sm font-medium text-black">
                            {a.date}
                          </p>
                          {a.note ? (
                            <p className="text-sm text-slate-800">{a.note}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 flex-1 border-slate-300 text-black"
                              onClick={() => openAdvanceEdit(a)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Upravit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-11 flex-1 text-destructive"
                              onClick={() => deleteAdvance(a)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Smazat
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-md border md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-black">Datum</TableHead>
                            <TableHead className="text-black">Částka</TableHead>
                            <TableHead className="text-black">Stav</TableHead>
                            <TableHead className="text-black">Poznámka</TableHead>
                            <TableHead className="text-black">Akce</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedAdvances.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="text-black">{a.date}</TableCell>
                              <TableCell className="font-bold text-black">
                                {formatKc(a.amount)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  size="sm"
                                  className={cn(
                                    "min-h-10 font-semibold",
                                    a.status === "paid"
                                      ? "bg-red-600 hover:bg-red-600"
                                      : "bg-emerald-600 hover:bg-emerald-600"
                                  )}
                                  onClick={() => toggleAdvancePaid(a)}
                                >
                                  {a.status === "paid"
                                    ? "Označit nezaplaceno"
                                    : "Označit zaplaceno"}
                                </Button>
                              </TableCell>
                              <TableCell className="max-w-xs text-black">
                                {a.note || "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="text-black"
                                    onClick={() => openAdvanceEdit(a)}
                                    aria-label="Upravit"
                                  >
                                    <Pencil className="h-5 w-5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => deleteAdvance(a)}
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
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="debts" className="mt-4 space-y-4">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-lg text-black">Dluh</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-black">Částka dluhu (Kč)</Label>
                  <Input value={newDebtAmount} onChange={(e) => setNewDebtAmount(e.target.value)} inputMode="decimal" placeholder="např. 2500" />
                </div>
                <div className="space-y-2">
                  <Label className="text-black">Datum</Label>
                  <Input type="date" value={newDebtDate} onChange={(e) => setNewDebtDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-black">Typ dluhu</Label>
                  <div className="flex flex-wrap gap-2">
                    {(["tool_damage", "loan", "deduction", "other"] as EmployeeDebtReason[]).map((r) => (
                      <Button key={r} type="button" size="sm" variant={newDebtReason === r ? "default" : "outline"} onClick={() => setNewDebtReason(r)}>
                        {r === "tool_damage" ? "Poškození nářadí" : r === "loan" ? "Půjčka" : r === "deduction" ? "Srážka" : "Jiný důvod"}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-black">Poznámka / důvod</Label>
                  <Textarea value={newDebtNote} onChange={(e) => setNewDebtNote(e.target.value)} rows={3} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" className="min-h-[44px]" onClick={addDebt} disabled={savingDebt}>
                    {savingDebt ? <Loader2 className="h-4 w-4 animate-spin" /> : "Dluh"}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-slate-200 bg-white"><CardContent className="pt-4"><p className="text-xs text-neutral-700">Celkové zálohy</p><p className="text-lg font-bold">{formatKc(paidTotal)}</p></CardContent></Card>
              <Card className="border-slate-200 bg-white"><CardContent className="pt-4"><p className="text-xs text-neutral-700">Celkový dluh</p><p className="text-lg font-bold">{formatKc(debtTotals.totalDebt)}</p></CardContent></Card>
              <Card className="border-slate-200 bg-white"><CardContent className="pt-4"><p className="text-xs text-neutral-700">Celkem splaceno</p><p className="text-lg font-bold">{formatKc(debtTotals.repaidDebt)}</p></CardContent></Card>
              <Card className="border-slate-200 bg-white"><CardContent className="pt-4"><p className="text-xs text-neutral-700">Zbývá doplatit</p><p className="text-lg font-bold">{formatKc(debtTotals.remainingDebt)}</p></CardContent></Card>
            </div>
            <Card className="border-slate-200 bg-white">
              <CardHeader><CardTitle className="text-lg text-black">Seznam dluhů a splátek</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {debts.length === 0 ? <p className="text-sm text-neutral-700">Žádné dluhy.</p> : debts.map((d) => {
                  const payments = debtPayments.filter((p) => p.debtId === d.id);
                  const repaid = Math.max(0, Math.round((d.amount - d.remainingAmount) * 100) / 100);
                  const reasonLabel =
                    d.reason === "tool_damage"
                      ? "Poškození nářadí"
                      : d.reason === "loan"
                        ? "Půjčka"
                        : d.reason === "deduction"
                          ? "Srážka"
                          : "Jiný důvod";
                  const statusBadge =
                    d.status === "overpaid" ? (
                      <Badge className="bg-violet-600 text-white hover:bg-violet-600">Přeplaceno</Badge>
                    ) : d.status === "active" ? (
                      <Badge className="bg-amber-600 text-white hover:bg-amber-600">Aktivní</Badge>
                    ) : (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Splaceno</Badge>
                    );
                  return (
                    <div key={d.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold text-black">
                            Částka dluhu: {formatKc(d.amount)} · {d.date}
                          </p>
                          <p className="text-xs text-neutral-700">
                            Důvod: {reasonLabel}
                            {d.note ? ` · ${d.note}` : ""}
                          </p>
                          <p className="text-xs text-neutral-800">
                            Splaceno: {formatKc(repaid)} ·{" "}
                            {d.remainingAmount < 0 ? (
                              <>
                                Přeplaceno o {formatKc(Math.abs(d.remainingAmount))}
                              </>
                            ) : (
                              <>Zbývá: {formatKc(d.remainingAmount)}</>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          {statusBadge}
                          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-black" aria-label="Upravit dluh" onClick={() => openDebtEdit(d)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-destructive"
                            aria-label="Smazat dluh"
                            onClick={() => {
                              setDebtToDelete(d);
                              setDebtDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="sm" onClick={() => openDebtPayment(d.id)}>
                            Přidat splátku
                          </Button>
                        </div>
                      </div>
                      {payments.length > 0 ? (
                        <div className="mt-2 rounded border border-slate-200">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Datum</TableHead>
                                <TableHead>Částka</TableHead>
                                <TableHead>Poznámka</TableHead>
                                <TableHead>Zapsal</TableHead>
                                <TableHead className="w-[100px] text-right">Akce</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {payments.map((p) => (
                                <TableRow key={p.id}>
                                  <TableCell>{p.date}</TableCell>
                                  <TableCell>{formatKc(p.amount)}</TableCell>
                                  <TableCell>{p.note || "—"}</TableCell>
                                  <TableCell>{p.createdBy || "—"}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        aria-label="Upravit splátku"
                                        onClick={() => openPaymentEdit(p)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-destructive"
                                        aria-label="Smazat splátku"
                                        onClick={() => {
                                          setPaymentToDelete(p);
                                          setPaymentDeleteOpen(true);
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={advanceEditOpen} onOpenChange={setAdvanceEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-black">Upravit zálohu</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label className="text-black">Částka (Kč)</Label>
              <Input
                className="h-12 border-slate-300 bg-white text-black"
                value={editAdvAmount}
                onChange={(e) => setEditAdvAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Datum</Label>
              <Input
                type="date"
                className="h-12 border-slate-300 bg-white text-black"
                value={editAdvDate}
                onChange={(e) => setEditAdvDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Poznámka</Label>
              <Textarea
                className="border-slate-300 bg-white text-black"
                value={editAdvNote}
                onChange={(e) => setEditAdvNote(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={editAdvStatus === "unpaid" ? "default" : "outline"}
                className="h-12 flex-1"
                onClick={() => setEditAdvStatus("unpaid")}
              >
                Nezaplaceno
              </Button>
              <Button
                type="button"
                variant={editAdvStatus === "paid" ? "default" : "outline"}
                className="h-12 flex-1 bg-emerald-600 hover:bg-emerald-600"
                onClick={() => setEditAdvStatus("paid")}
              >
                Zaplaceno
              </Button>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-12 text-black"
              onClick={() => setAdvanceEditOpen(false)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="h-12"
              disabled={savingAdvEdit}
              onClick={saveAdvanceEdit}
            >
              {savingAdvEdit ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Uložit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={paymentOpen}
        onOpenChange={(o) => {
          setPaymentOpen(o);
          if (!o) setEditingPayment(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-black">
              {editingPayment ? "Upravit splátku" : "Nová splátka dluhu"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label className="text-black">Částka (Kč)</Label>
              <Input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Datum</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Poznámka</Label>
              <Textarea value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={savingPayment} onClick={() => void saveDebtPayment()}>
              {savingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={debtEditOpen} onOpenChange={setDebtEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-black">Upravit dluh</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label className="text-black">Částka dluhu (Kč)</Label>
              <Input value={editDebtAmount} onChange={(e) => setEditDebtAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Datum</Label>
              <Input type="date" value={editDebtDate} onChange={(e) => setEditDebtDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-black">Důvod</Label>
              <div className="flex flex-wrap gap-2">
                {(["tool_damage", "loan", "deduction", "other"] as EmployeeDebtReason[]).map((r) => (
                  <Button key={r} type="button" size="sm" variant={editDebtReason === r ? "default" : "outline"} onClick={() => setEditDebtReason(r)}>
                    {r === "tool_damage" ? "Poškození nářadí" : r === "loan" ? "Půjčka" : r === "deduction" ? "Srážka" : "Jiný důvod"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-black">Poznámka</Label>
              <Textarea value={editDebtNote} onChange={(e) => setEditDebtNote(e.target.value)} rows={3} />
            </div>
            <p className="text-xs text-neutral-600">
              Po uložení se zůstatek přepočítá ze všech splátek: zbývá = částka dluhu − součet splátek.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDebtEditOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={savingDebtEdit} onClick={() => void saveDebtEdit()}>
              {savingDebtEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={debtDeleteOpen} onOpenChange={setDebtDeleteOpen}>
        <AlertDialogContent className="border-slate-200 bg-white text-black">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat dluh?</AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-700">
              {debtToDelete
                ? `Trvale smažete dluh ${formatKc(debtToDelete.amount)} (${debtToDelete.date}) a všechny navázané splátky. Tuto akci nelze vrátit.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300">Zrušit</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingDebt}
              onClick={() => void confirmDeleteDebt()}
            >
              {deletingDebt ? <Loader2 className="h-4 w-4 animate-spin" /> : "Smazat"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={paymentDeleteOpen} onOpenChange={setPaymentDeleteOpen}>
        <AlertDialogContent className="border-slate-200 bg-white text-black">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat splátku?</AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-700">
              {paymentToDelete
                ? `Opravdu smazat splátku ${formatKc(paymentToDelete.amount)} (${paymentToDelete.date})? Zůstatek dluhu se znovu přepočítá.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300">Zrušit</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingPayment}
              onClick={() => void confirmDeletePayment()}
            >
              {deletingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : "Smazat"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-black">Kontrola výkazu</DialogTitle>
          </DialogHeader>
          {reviewBlock && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-slate-800">
                Datum {reviewBlock.date}, výkazované hodiny:{" "}
                <strong>{reviewBlock.hours}</strong> h · {reviewBlock.startTime}–
                {reviewBlock.endTime}
                {reviewBlock.jobName || reviewBlock.jobId ? (
                  <>
                    {" "}
                    · zakázka:{" "}
                    <strong>
                      {String(reviewBlock.jobName ?? "").trim() ||
                        reviewBlock.jobId}
                    </strong>
                  </>
                ) : null}
              </p>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <Label className="text-xs font-semibold uppercase text-slate-800">
                  Popis práce (z výkazu zaměstnance)
                </Label>
                <p className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-sm text-black">
                  {getWorklogDescriptionOriginal(reviewBlock) || "—"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-black">Schválené hodiny</Label>
                <Input
                  className="h-12 border-slate-300 bg-white text-base text-black"
                  value={approvedHoursInput}
                  onChange={(e) => setApprovedHoursInput(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-black">Poznámka administrátora</Label>
                <Textarea
                  className="border-slate-300 bg-white text-base text-black"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-black">
                  Důvod úpravy (povinné při změně hodin)
                </Label>
                <Textarea
                  className="border-slate-300 bg-white text-base text-black"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  rows={2}
                  placeholder="např. oprava přestávky…"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-12 border-slate-300 text-black"
              onClick={() => setReviewOpen(false)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="h-12"
              disabled={savingReview}
              onClick={() => saveReview(false)}
            >
              {savingReview ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Uložit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayrollAdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[30vh] items-center justify-center gap-2 text-black">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Načítání…</span>
        </div>
      }
    >
      <PayrollAdminPageInner />
    </Suspense>
  );
}
