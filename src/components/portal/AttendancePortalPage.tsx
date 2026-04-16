"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Loader2,
  UserCheck,
  History,
  Smartphone,
  LayoutDashboard,
  FileText,
  Copy,
  PanelRightOpen,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  useUser,
  useFirebase,
  useDoc,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { formatKc } from "@/lib/employee-money";
import { AdminDailyWorkReportDetailSheet } from "@/components/portal/AdminDailyWorkReportDetailSheet";
import { EmployeeAttendanceOverview } from "@/app/portal/employee/employee-attendance-overview";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Veřejná cesta terminálu — pouze z kanonického companyId (žádná jiná adresa do QR). */
function buildAttendanceTerminalPath(companyId: string): string {
  return `/attendance-login?companyId=${encodeURIComponent(companyId)}`;
}

/** Jen malý QR vedle hodin; žádné velké QR uprostřed stránky. */
function AttendanceTerminalQrSection({
  terminalPath,
  qrSize = 80,
  className,
}: {
  terminalPath: string;
  qrSize?: number;
  className?: string;
}) {
  const { toast } = useToast();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const fullUrl =
    origin &&
    terminalPath.startsWith("/attendance-login?companyId=") &&
    !terminalPath.includes("://")
      ? `${origin}${terminalPath}`
      : "";

  const copyUrl = () => {
    if (!fullUrl) return;
    void navigator.clipboard.writeText(fullUrl).then(
      () =>
        toast({
          title: "Zkopírováno",
          description: "Odkaz na terminál docházky je ve schránce.",
        }),
      () =>
        toast({
          variant: "destructive",
          title: "Kopírování se nezdařilo",
          description: "Zkopírujte adresu ručně z řádku prohlížeče.",
        })
    );
  };

  const shellClass =
    className ??
    "flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm";

  return (
    <div className={shellClass}>
      {fullUrl ? (
        <>
          <div className="inline-flex rounded-md border border-slate-100 bg-white p-1 shadow-inner">
            <QRCodeSVG
              value={fullUrl}
              size={qrSize}
              level="M"
              includeMargin
              className="h-auto w-full max-h-[88px] max-w-[88px]"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={copyUrl}
            title="Kopírovat odkaz na terminál"
          >
            <Copy className="h-4 w-4 shrink-0" />
          </Button>
        </>
      ) : (
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export function AttendancePortalPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const { firestore, areServicesAvailable } = useFirebase();
  const { toast } = useToast();
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [adminDwrDetail, setAdminDwrDetail] = useState<{ employeeId: string; date: string } | null>(
    null
  );
  const ALL_EMPLOYEES = "__all__";
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(ALL_EMPLOYEES);

  const userRef = useMemoFirebase(
    () =>
      areServicesAvailable && user && firestore
        ? doc(firestore, "users", user.uid)
        : null,
    [areServicesAvailable, firestore, user?.uid]
  );

  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;
  const { companyName } = useCompany();
  const orgLabel = companyName || companyId || "vaší organizace";

  const terminalPath = useMemo(
    () => (companyId ? buildAttendanceTerminalPath(companyId) : ""),
    [companyId]
  );

  const role = (profile as { role?: string } | null)?.role ?? "employee";
  const globalRoles = (profile as { globalRoles?: string[] } | null)?.globalRoles;
  const isAttendancePrivileged =
    (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) ||
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant";

  /** Terminál (odkaz, QR, hodiny) jen pro správcovské role — ne v zobrazení běžného zaměstnance. */
  const showTerminalWidgets = isAttendancePrivileged;

  /**
   * Zaměstnanec bez správcovských práv — stejné chování na /portal/labor/dochazka i v employee větvi.
   */
  const isEmployeePortal = role === "employee" && !isAttendancePrivileged;

  useEffect(() => {
    if (!showTerminalWidgets) {
      setCurrentTime(null);
      return;
    }
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [showTerminalWidgets]);

  const profileEmployeeId = (profile as { employeeId?: string } | null)?.employeeId as
    | string
    | undefined;

  const employeeRowRef = useMemoFirebase(
    () =>
      areServicesAvailable && firestore && companyId && profileEmployeeId
        ? doc(firestore, "companies", companyId, "employees", profileEmployeeId)
        : null,
    [areServicesAvailable, firestore, companyId, profileEmployeeId]
  );
  const { data: employeeRow } = useDoc<Record<string, unknown>>(employeeRowRef);

  const hourlyRateEmployee = useMemo(() => {
    const fromEmp = Number(employeeRow?.hourlyRate);
    const fromUser = Number((profile as { hourlyRate?: unknown } | null)?.hourlyRate);
    if (Number.isFinite(fromEmp) && fromEmp > 0) return fromEmp;
    if (Number.isFinite(fromUser) && fromUser > 0) return fromUser;
    return 0;
  }, [employeeRow?.hourlyRate, profile]);

  const employeeDisplayName =
    (profile as { displayName?: string })?.displayName ||
    [(profile as { firstName?: string })?.firstName, (profile as { lastName?: string })?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    user?.email ||
    "Zaměstnanec";

  /**
   * Dotaz na attendance jen pro oprávněné role (přehled firmy).
   * Pro role `employee` (a jiné neprivilegované) se nespouští — vyhýbá se složenému indexu
   * `employeeId` + `timestamp` a zbytečnému odposlechu; úder řeší terminál / attendance-login.
   */
  const attendanceQueryEnabled = Boolean(
    areServicesAvailable && firestore && companyId && user && isAttendancePrivileged
  );

  const attendanceQuery = useMemoFirebase(() => {
    if (!attendanceQueryEnabled) return null;
    const base = collection(firestore!, "companies", companyId!, "attendance");
    return query(base, orderBy("timestamp", "desc"), limit(100));
  }, [attendanceQueryEnabled, firestore, companyId]);

  const {
    data: historyData = [],
    isLoading: isHistoryLoading,
  } = useCollection(attendanceQuery);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId || !isAttendancePrivileged)
      return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      orderBy("updatedAt", "desc"),
      limit(800)
    );
  }, [areServicesAvailable, firestore, companyId, isAttendancePrivileged]);

  const {
    data: dailyReports = [],
    isLoading: dailyReportsLoading,
  } = useCollection(dailyReportsQuery);

  const employeesQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId || !isAttendancePrivileged) return null;
    return query(
      collection(firestore, "companies", companyId, "employees"),
      orderBy("lastName", "asc"),
      limit(500)
    );
  }, [areServicesAvailable, firestore, companyId, isAttendancePrivileged]);

  const { data: employees = [] } = useCollection<Record<string, unknown>>(employeesQuery);

  const employeeOptions = useMemo(() => {
    const rows = Array.isArray(employees) ? employees : [];
    const items = rows
      .map((e) => {
        const id = String((e as any).id ?? "");
        const fn = String((e as any).firstName ?? "").trim();
        const ln = String((e as any).lastName ?? "").trim();
        const name = [fn, ln].filter(Boolean).join(" ").trim() || String((e as any).name ?? "").trim();
        return { id, label: name || id };
      })
      .filter((x) => x.id && x.label);
    // Fallback sort by label (in case lastName missing)
    items.sort((a, b) => a.label.localeCompare(b.label, "cs"));
    return items;
  }, [employees]);

  const filteredDailyReports = useMemo(() => {
    const rows = Array.isArray(dailyReports) ? (dailyReports as Record<string, unknown>[]) : [];
    if (!selectedEmployeeId || selectedEmployeeId === ALL_EMPLOYEES) return rows;
    return rows.filter((r) => String(r.employeeId ?? "") === selectedEmployeeId);
  }, [dailyReports, selectedEmployeeId]);

  const tabParam = searchParams.get("tab");
  const tabsKey = "priv";
  const defaultTab = useMemo(() => {
    if (!isAttendancePrivileged) return "overview";
    if (
      tabParam === "overview" ||
      tabParam === "history" ||
      tabParam === "approvals" ||
      tabParam === "team"
    ) {
      return tabParam;
    }
    return "overview";
  }, [isAttendancePrivileged, tabParam]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("role", role);
    console.log("isEmployeePortal", isEmployeePortal);
    console.log("showTerminalWidgets", showTerminalWidgets);
  }, [role, isEmployeePortal, showTerminalWidgets]);

  const reviewDailyReport = async (
    employeeId: string,
    date: string,
    action: "approve" | "reject" | "return"
  ) => {
    if (!user || !companyId) return;
    const key = `${employeeId}_${date}_${action}`;
    setReviewBusy(key);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/daily-work-reports/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId, employeeId, date, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data.error || "Akci se nepodařilo provést.",
        });
        return;
      }
      const title =
        action === "approve"
          ? "Schváleno"
          : action === "reject"
            ? "Zamítnuto"
            : "Vráceno k úpravě";
      toast({
        title,
        description: "Stav denního výkazu byl uložen.",
      });
    } catch {
      toast({ variant: "destructive", title: "Chyba", description: "Síťová chyba." });
    } finally {
      setReviewBusy(null);
    }
  };

  const getStatusBadge = (type: string) => {
    switch (type) {
      case "check_in":
        return <Badge className="bg-emerald-500">Příchod</Badge>;
      case "break_start":
        return (
          <Badge variant="secondary" className="bg-amber-500 text-white">
            Pauza (začátek)
          </Badge>
        );
      case "break_end":
        return (
          <Badge variant="secondary" className="bg-blue-500 text-white">
            Pauza (konec)
          </Badge>
        );
      case "check_out":
        return <Badge variant="destructive">Odchod</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const reportStatusBadge = (s: string | undefined) => {
    switch (s) {
      case "draft":
        return (
          <Badge variant="secondary" className="bg-slate-600 text-white">
            Rozpracováno
          </Badge>
        );
      case "pending":
        return <Badge className="bg-amber-500">Odesláno ke schválení</Badge>;
      case "approved":
        return <Badge className="bg-emerald-600">Schváleno</Badge>;
      case "rejected":
        return <Badge variant="destructive">Zamítnuto</Badge>;
      case "returned":
        return <Badge className="bg-violet-600">K úpravě</Badge>;
      default:
        return <Badge variant="outline">{s || "—"}</Badge>;
    }
  };

  const pendingReports = (Array.isArray(dailyReports) ? dailyReports : []).filter(
    (r: { status?: string }) => r.status === "pending"
  );

  if (!user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Načítání profilu…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Docházka</h1>
          <div className="portal-page-description">
            Organizace:{" "}
            <span className="font-semibold text-primary">{orgLabel}</span>
            {!showTerminalWidgets ? (
              <p className="mt-2 text-sm font-normal text-muted-foreground">
                Níže je váš osobní přehled docházky a souvisejících údajů. Terminál a správa pro celou firmu
                mají pouze oprávnění administrátora.
              </p>
            ) : null}
          </div>
        </div>

        {showTerminalWidgets ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-end sm:gap-4 lg:flex-1">
            {terminalPath ? (
              <Link
                href={terminalPath}
                className="inline-flex min-w-0 shrink-0"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button className="min-h-[44px] w-full gap-2 sm:w-auto">
                  <Smartphone className="h-4 w-4 shrink-0" />
                  Přihlášení zaměstnance
                </Button>
              </Link>
            ) : null}

            <div className="flex min-w-0 w-full justify-end sm:ml-auto sm:max-w-full">
              <div className="flex max-w-full flex-wrap items-start justify-end gap-3 rounded-xl border border-slate-200 bg-white p-3 text-right shadow-sm sm:gap-4 sm:p-4">
                <div className="min-w-[160px] shrink text-right">
                  <p className="font-mono text-3xl font-bold text-primary sm:text-4xl">
                    {currentTime || "--:--:--"}
                  </p>
                  <p className="text-sm font-medium text-muted-foreground">
                    {new Date().toLocaleDateString("cs-CZ", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                {terminalPath ? (
                  <AttendanceTerminalQrSection
                    terminalPath={terminalPath}
                    qrSize={80}
                    className="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2"
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isAttendancePrivileged ? (
        <Tabs
          key={`${tabsKey}-${tabParam ?? ""}`}
          defaultValue={defaultTab}
          className="w-full overflow-hidden"
        >
          <TabsList className="mb-4 flex h-auto flex-wrap gap-1 border border-slate-200 bg-white p-1 sm:mb-6">
            <TabsTrigger value="overview" className="min-h-[44px] flex-1 gap-2 sm:flex-initial sm:min-h-0">
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              Přehled
            </TabsTrigger>
            <TabsTrigger value="history" className="min-h-[44px] flex-1 gap-2 sm:flex-initial sm:min-h-0">
              <History className="h-4 w-4 shrink-0" />
              Historie docházky
            </TabsTrigger>
            <TabsTrigger value="approvals" className="min-h-[44px] flex-1 gap-2 sm:flex-initial sm:min-h-0">
              <FileText className="h-4 w-4 shrink-0" />
              Schvalování výkazů
            </TabsTrigger>
            <TabsTrigger value="team" className="min-h-[44px] flex-1 gap-2 sm:flex-initial sm:min-h-0">
              <UserCheck className="h-4 w-4 shrink-0" />
              Přehled týmu
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border bg-surface">
                <CardHeader>
                  <CardTitle>Veřejné přihlášení zaměstnanců</CardTitle>
                  <CardDescription>
                    Administrátor se do docházky nepřihlašuje jako zaměstnanec — použijte terminál s PINem.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Odkaz otevřete na tabletu nebo sdíleném PC. Zaměstnanci se hlásí výběrem profilu a PINem.
                  </p>
                  {terminalPath ? (
                    <div className="min-w-0 shrink-0">
                      <Link
                        href={terminalPath}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button className="min-h-[44px] w-full gap-2 sm:w-auto">
                          <Smartphone className="h-4 w-4" />
                          Otevřít /attendance-login
                        </Button>
                      </Link>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-border bg-surface">
                <CardHeader>
                  <CardTitle>Rychlý přehled</CardTitle>
                  <CardDescription>Poslední aktivita v docházce (zobrazeno v Historii)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium text-foreground">Čekající denní výkazy:</span>{" "}
                    {dailyReportsLoading ? "…" : pendingReports.length}
                  </p>
                  <p className="text-muted-foreground">
                    Zaměstnanci doplňují denní výkaz v zaměstnaneckém portálu (položka „Denní výkaz“). Schvalujte v záložce Schvalování výkazů.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

        <TabsContent value="history">
          <Card className="border-border bg-surface">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Historie docházky (firma)</CardTitle>
                <CardDescription>Poslední záznamy všech zaměstnanců</CardDescription>
              </div>
            </CardHeader>

            <CardContent>
              {isHistoryLoading ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : historyData && historyData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>Zaměstnanec</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Čas</TableHead>
                      <TableHead>Akce</TableHead>
                      <TableHead className="text-right">Zdroj</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {historyData.slice(0, 40).map((row: Record<string, unknown>, i: number) => (
                      <TableRow key={i} className="border-border hover:bg-muted/30">
                        <TableCell className="font-semibold">
                          {String(row.employeeName || row.employeeId || "")}
                        </TableCell>

                        <TableCell>
                          {row.timestamp &&
                          typeof row.timestamp === "object" &&
                          "toDate" in row.timestamp &&
                          typeof (row.timestamp as { toDate: () => Date }).toDate === "function"
                            ? (row.timestamp as { toDate: () => Date })
                                .toDate()
                                .toLocaleDateString("cs-CZ")
                            : "Dnes"}
                        </TableCell>

                        <TableCell>
                          {row.timestamp &&
                          typeof row.timestamp === "object" &&
                          "toDate" in row.timestamp &&
                          typeof (row.timestamp as { toDate: () => Date }).toDate === "function"
                            ? (row.timestamp as { toDate: () => Date })
                                .toDate()
                                .toLocaleTimeString("cs-CZ", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                            : "--:--"}
                        </TableCell>

                        <TableCell>{getStatusBadge(String(row.type || ""))}</TableCell>

                        <TableCell className="text-right text-xs text-muted-foreground italic">
                          {row.source === "attendance-login" ? "PIN" : String(row.terminalId || "Web")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-16 text-center text-muted-foreground">Zatím nejsou záznamy docházky.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals">
              <Card className="border-border bg-surface">
                <CardHeader>
                  <CardTitle>Denní výkazy práce</CardTitle>
                  <CardDescription>
                    Schvalování textových výkazů za den (navázané na docházku). U každého záznamu použijte{" "}
                    <span className="font-medium text-foreground">Detail</span> pro úplný přehled řádků, úpravy a
                    smazání. Blokové výkazy zůstávají ve mzdové části portálu.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="w-full md:max-w-[360px]">
                      <div className="text-sm font-medium text-foreground mb-2">Zaměstnanec</div>
                      <Select
                        value={selectedEmployeeId}
                        onValueChange={(v) => setSelectedEmployeeId(v)}
                      >
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="Všichni zaměstnanci" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_EMPLOYEES}>Všichni zaměstnanci</SelectItem>
                          {employeeOptions.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      {dailyReportsLoading ? "Načítám…" : `Zobrazeno: ${filteredDailyReports.length} záznamů`}
                    </div>
                  </div>

                  {dailyReportsLoading ? (
                    <div className="flex justify-center p-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : Array.isArray(filteredDailyReports) && filteredDailyReports.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datum</TableHead>
                          <TableHead>Zaměstnanec</TableHead>
                          <TableHead>Stav</TableHead>
                          <TableHead className="text-right whitespace-nowrap tabular-nums">Hodiny</TableHead>
                          <TableHead>Popis</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Segmenty (odhad)</TableHead>
                          <TableHead className="text-right whitespace-nowrap">K výplatě</TableHead>
                          <TableHead className="text-right">Akce</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDailyReports.map((row, i) => {
                          const employeeId = String(row.employeeId || "");
                          const date = String(row.date || "");
                          const st = String(row.status || "");
                          const busyApprove = reviewBusy === `${employeeId}_${date}_approve`;
                          const busyReject = reviewBusy === `${employeeId}_${date}_reject`;
                          const busyReturn = reviewBusy === `${employeeId}_${date}_return`;
                          return (
                            <TableRow key={`${employeeId}-${date}-${i}`}>
                              <TableCell className="font-medium whitespace-nowrap">{date}</TableCell>
                              <TableCell>{String(row.employeeName || employeeId)}</TableCell>
                              <TableCell>{reportStatusBadge(st)}</TableCell>
                              <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                {typeof row.hoursFromAttendance === "number" &&
                                Number.isFinite(row.hoursFromAttendance)
                                  ? `${row.hoursFromAttendance} h`
                                  : typeof row.hoursConfirmed === "number" &&
                                      Number.isFinite(row.hoursConfirmed)
                                    ? `${row.hoursConfirmed} h`
                                    : "—"}
                              </TableCell>
                              <TableCell className="max-w-[min(40vw,320px)] truncate text-sm text-muted-foreground">
                                {String(row.description || "—")}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                {typeof row.estimatedLaborFromSegmentsCzk === "number" &&
                                row.estimatedLaborFromSegmentsCzk > 0
                                  ? formatKc(row.estimatedLaborFromSegmentsCzk)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium tabular-nums">
                                {typeof row.payableAmountCzk === "number" && row.payableAmountCzk > 0
                                  ? formatKc(row.payableAmountCzk)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setAdminDwrDetail({ employeeId, date })}
                                  >
                                    <PanelRightOpen className="mr-1 h-4 w-4" />
                                    Detail
                                  </Button>
                                  {st === "pending" ? (
                                    <>
                                      <Button
                                        size="sm"
                                        className="bg-emerald-600 hover:bg-emerald-500"
                                        disabled={!!reviewBusy}
                                        onClick={() => void reviewDailyReport(employeeId, date, "approve")}
                                      >
                                        {busyApprove ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Schválit"
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!!reviewBusy}
                                        onClick={() => void reviewDailyReport(employeeId, date, "return")}
                                      >
                                        {busyReturn ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Vrátit k úpravě"
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={!!reviewBusy}
                                        onClick={() => void reviewDailyReport(employeeId, date, "reject")}
                                      >
                                        {busyReject ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Zamítnout"
                                        )}
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-16 text-center text-muted-foreground">Žádné denní výkazy.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="team">
              <Card className="border-border bg-surface">
                <CardHeader>
                  <CardTitle>Přehled týmu</CardTitle>
                  <CardDescription>Poslední záznamy všech zaměstnanců ({orgLabel})</CardDescription>
                </CardHeader>

                <CardContent>
                  {isHistoryLoading ? (
                    <div className="flex justify-center p-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : historyData && historyData.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead>Zaměstnanec</TableHead>
                          <TableHead>Datum</TableHead>
                          <TableHead>Čas</TableHead>
                          <TableHead>Akce</TableHead>
                          <TableHead className="text-right">Zařízení</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {historyData.slice(0, 30).map((row: Record<string, unknown>, i: number) => (
                          <TableRow key={i} className="border-border hover:bg-muted/30">
                            <TableCell className="font-semibold">
                              {String(row.employeeName || row.employeeId || "")}
                            </TableCell>

                            <TableCell>
                              {row.timestamp &&
                              typeof row.timestamp === "object" &&
                              "toDate" in row.timestamp &&
                              typeof (row.timestamp as { toDate: () => Date }).toDate === "function"
                                ? (row.timestamp as { toDate: () => Date })
                                    .toDate()
                                    .toLocaleDateString("cs-CZ")
                                : "Dnes"}
                            </TableCell>

                            <TableCell>
                              {row.timestamp &&
                              typeof row.timestamp === "object" &&
                              "toDate" in row.timestamp &&
                              typeof (row.timestamp as { toDate: () => Date }).toDate === "function"
                                ? (row.timestamp as { toDate: () => Date })
                                    .toDate()
                                    .toLocaleTimeString("cs-CZ", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                : "--:--"}
                            </TableCell>

                            <TableCell>{getStatusBadge(String(row.type || ""))}</TableCell>

                            <TableCell className="text-right text-xs italic text-muted-foreground">
                              {row.source === "attendance-login" ? "PIN" : String(row.terminalId || "Web")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-16 text-center text-muted-foreground">Zatím nejsou záznamy docházky.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
      </Tabs>
      ) : companyId && profileEmployeeId && user ? (
        <EmployeeAttendanceOverview
          companyId={companyId}
          employeeId={profileEmployeeId}
          authUserId={user.uid}
          employeeDisplayName={employeeDisplayName}
          companyName={companyName}
          hourlyRate={hourlyRateEmployee}
        />
      ) : (
        <Card className="border-border bg-surface">
          <CardHeader>
            <CardTitle>Docházka</CardTitle>
            <CardDescription>
              Pro zobrazení osobního přehledu chybí propojení účtu se záznamem zaměstnance. Kontaktujte
              administrátora.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {companyId && user && isAttendancePrivileged ? (
        <AdminDailyWorkReportDetailSheet
          open={!!adminDwrDetail}
          onOpenChange={(v) => {
            if (!v) setAdminDwrDetail(null);
          }}
          companyId={companyId}
          employeeId={adminDwrDetail?.employeeId ?? ""}
          date={adminDwrDetail?.date ?? ""}
          user={user}
          authUid={user?.uid ?? ""}
        />
      ) : null}
    </div>
  );
}
