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
  sumMoneyForBlocks,
  sumMoneyForApprovedDailyReports,
  sumPaidAdvances,
  sumPayableHoursForBlocks,
  type AdvanceDoc,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import {
  buildWorklogPdfFileName,
  downloadWorklogPdfFromElement,
} from "@/lib/worklog-report-pdf";
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
import {
  getWorklogDescriptionOriginal,
  getWorklogLanguage,
} from "@/lib/worklog-description-fields";
import {
  translateToCzech,
  translateToCzechSync,
} from "@/lib/translate-to-czech";

const PRIV_ROLES = ["owner", "admin", "manager", "accountant"];

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
    if (selectedEmployeeId === "all") {
      return query(
        collection(firestore, "companies", companyId, "work_time_blocks"),
        orderBy("date", "desc"),
        limit(500)
      );
    }
    if (!selectedEmployeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", selectedEmployeeId),
      limit(500)
    );
  }, [firestore, companyId, selectedEmployeeId]);

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
    if (!firestore || !companyId || !selectedEmployeeId) return null;
    if (selectedEmployeeId === "all") {
      return query(
        collection(firestore, "companies", companyId, "daily_work_reports"),
        limit(500)
      );
    }
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", selectedEmployeeId),
      limit(500)
    );
  }, [firestore, companyId, selectedEmployeeId]);

  const { data: dailyReportsRaw = [] } = useCollection(dailyReportsQuery);

  const blocks = useMemo(() => {
    const raw = Array.isArray(blocksRaw) ? blocksRaw : [];
    return raw.map((b: any) => ({ ...b, id: String(b?.id ?? "") }));
  }, [blocksRaw]);

  const blocksMoney = blocks as WorkTimeBlockMoney[];

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
  const earnedFromBlocks = useMemo(
    () => sumMoneyForBlocks(blocksMoney, hourlyRate),
    [blocksMoney, hourlyRate]
  );
  const earnedFromDailyReports = useMemo(() => {
    const raw = Array.isArray(dailyReportsRaw) ? dailyReportsRaw : [];
    return sumMoneyForApprovedDailyReports(raw as DailyWorkReportMoney[]);
  }, [dailyReportsRaw]);
  const earnedAll = useMemo(
    () =>
      Math.round((earnedFromBlocks + earnedFromDailyReports) * 100) / 100,
    [earnedFromBlocks, earnedFromDailyReports]
  );
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

  const reportEmployeeTitle =
    selectedEmployeeId === "all"
      ? "Všichni zaměstnanci"
      : employeeLabelById[selectedEmployeeId] || selectedEmployeeId || "—";

  const reportPeriodLabel = useMemo(() => {
    if (sortedBlocks.length === 0) return "Žádné záznamy v přehledu";
    const dates = sortedBlocks
      .map((b) => String(b.date ?? ""))
      .filter(Boolean);
    const sorted = [...dates].sort();
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    return min === max ? `Datum: ${min}` : `Období: ${min} – ${max}`;
  }, [sortedBlocks]);

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
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
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
        </CardContent>
      </Card>

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
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-slate-100 p-1 print:hidden sm:max-w-md">
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
                              <TableHead className="text-black">Výkaz h</TableHead>
                              <TableHead className="text-black">Schv. h</TableHead>
                              <TableHead className="text-black">Stav</TableHead>
                              <TableHead className="print:hidden">Akce</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedBlocks.map((b) => (
                              <TableRow key={b.id}>
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
