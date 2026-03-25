"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { doc, collection, query, orderBy, limit } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_LIMIT_STEP = 75;
const MAX_EXPORT = 500;

type ActivityRow = {
  id: string;
  actionType?: string;
  actionLabel?: string;
  entityType?: string;
  entityId?: string | null;
  entityName?: string | null;
  details?: string | null;
  sourceModule?: string | null;
  route?: string | null;
  userId?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  employeeEmail?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: { toDate?: () => Date };
};

type SessionRow = {
  id: string;
  sessionId?: string;
  userId?: string;
  employeeName?: string | null;
  employeeEmail?: string | null;
  loginAt?: { toDate?: () => Date } | null;
  logoutAt?: { toDate?: () => Date } | null;
  lastSeenAt?: { toDate?: () => Date } | null;
  isActive?: boolean;
  durationSeconds?: number | null;
  durationMinutes?: number | null;
  deviceType?: string | null;
  source?: string | null;
  lastRoute?: string | null;
};

function formatDt(v: unknown): string {
  if (v == null) return "—";
  try {
    if (typeof (v as { toDate?: () => Date }).toDate === "function") {
      return (v as { toDate: () => Date }).toDate().toLocaleString("cs-CZ");
    }
    if (v instanceof Date) return v.toLocaleString("cs-CZ");
    return String(v);
  } catch {
    return "—";
  }
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h} h ${rm} min`;
  }
  return `${m} min ${s} s`;
}

export default function AuditReportPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const canAccess =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    (Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin"));

  const [tab, setTab] = useState<"activity" | "sessions">("activity");
  const [listLimit, setListLimit] = useState(PAGE_LIMIT_STEP);

  const [employeeQ, setEmployeeQ] = useState("");
  const [actionQ, setActionQ] = useState("");
  const [moduleQ, setModuleQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preset, setPreset] = useState<string>("all");

  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null);

  const logsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !canAccess) return null;
    return query(
      collection(firestore, "companies", companyId, "activityLogs"),
      orderBy("createdAt", "desc"),
      limit(Math.min(listLimit, MAX_EXPORT))
    );
  }, [firestore, companyId, canAccess, listLimit]);

  const sessionsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !canAccess) return null;
    return query(
      collection(firestore, "companies", companyId, "staffSessions"),
      orderBy("loginAt", "desc"),
      limit(Math.min(listLimit, MAX_EXPORT))
    );
  }, [firestore, companyId, canAccess, listLimit]);

  const { data: logsRaw, isLoading: logsLoading } =
    useCollection<ActivityRow>(logsQuery);
  const { data: sessionsRaw, isLoading: sessionsLoading } =
    useCollection<SessionRow>(sessionsQuery);

  const employeesCol = useMemoFirebase(() => {
    if (!firestore || !companyId || !canAccess) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId, canAccess]);

  const { data: employees } = useCollection<{
    id: string;
    displayName?: string;
    name?: string;
    authUserId?: string;
  }>(employeesCol);

  const employeeFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees ?? []) {
      const label =
        e.displayName?.trim() ||
        e.name?.trim() ||
        e.authUserId?.slice(0, 8) ||
        e.id;
      if (e.authUserId) m.set(`uid:${e.authUserId}`, label);
      if (e.id) m.set(`emp:${e.id}`, label);
    }
    for (const row of logsRaw ?? []) {
      if (row.userId)
        m.set(`uid:${row.userId}`, row.employeeName || row.userId);
    }
    return [...m.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "cs", { sensitivity: "base" })
    );
  }, [employees, logsRaw]);

  const filteredLogs = useMemo(() => {
    let list = [...(logsRaw ?? [])];
    const ef = employeeQ.trim();
    if (ef && ef !== "__all__") {
      if (ef.startsWith("uid:")) {
        const uid = ef.slice(4);
        list = list.filter((r) => r.userId === uid);
      } else if (ef.startsWith("emp:")) {
        const eid = ef.slice(4);
        list = list.filter((r) => r.employeeId === eid);
      }
    }
    const aq = actionQ.trim().toLowerCase();
    if (aq) list = list.filter((r) => (r.actionType ?? "").toLowerCase().includes(aq));
    const mq = moduleQ.trim().toLowerCase();
    if (mq) list = list.filter((r) => (r.sourceModule ?? "").toLowerCase().includes(mq));
    if (dateFrom)
      list = list.filter((r) => {
        const t = r.createdAt?.toDate?.();
        if (!t) return false;
        return t >= new Date(dateFrom + "T00:00:00");
      });
    if (dateTo)
      list = list.filter((r) => {
        const t = r.createdAt?.toDate?.();
        if (!t) return false;
        return t <= new Date(dateTo + "T23:59:59.999");
      });
    if (preset === "auth")
      list = list.filter((r) => (r.actionType ?? "").startsWith("auth."));
    if (preset === "docs") {
      list = list.filter((r) => {
        const at = r.actionType ?? "";
        const et = r.entityType ?? "";
        return (
          at.startsWith("document") ||
          at.startsWith("job_media") ||
          at.startsWith("job_expense") ||
          ["document", "company_document", "job_document"].includes(et)
        );
      });
    }
    if (preset === "jobs")
      list = list.filter(
        (r) =>
          (r.entityType ?? "") === "job" ||
          (r.actionType ?? "").startsWith("job.")
      );
    if (preset === "expenses")
      list = list.filter(
        (r) =>
          (r.entityType ?? "").includes("expense") ||
          (r.actionType ?? "").includes("expense")
      );
    if (preset === "create")
      list = list.filter((r) => (r.actionType ?? "").includes("create"));
    if (preset === "update")
      list = list.filter((r) => (r.actionType ?? "").includes("update"));
    if (preset === "delete")
      list = list.filter((r) => (r.actionType ?? "").includes("delete"));
    return list;
  }, [
    logsRaw,
    employeeQ,
    actionQ,
    moduleQ,
    dateFrom,
    dateTo,
    preset,
  ]);

  const filteredSessions = useMemo(() => {
    let list = [...(sessionsRaw ?? [])];
    const ef = employeeQ.trim();
    if (ef && ef !== "__all__" && ef.startsWith("uid:")) {
      const uid = ef.slice(4);
      list = list.filter((r) => r.userId === uid);
    }
    if (dateFrom)
      list = list.filter((r) => {
        const t = r.loginAt?.toDate?.();
        if (!t) return false;
        return t >= new Date(dateFrom + "T00:00:00");
      });
    if (dateTo)
      list = list.filter((r) => {
        const t = r.loginAt?.toDate?.();
        if (!t) return false;
        return t <= new Date(dateTo + "T23:59:59.999");
      });
    if (preset === "auth") return list;
    if (preset !== "all" && tab === "sessions")
      return list;
    return list;
  }, [sessionsRaw, employeeQ, dateFrom, dateTo, preset, tab]);

  if (profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId || !user) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Chybí kontext</AlertTitle>
        <AlertDescription>Přihlaste se a vyberte firmu.</AlertDescription>
      </Alert>
    );
  }

  if (!canAccess) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Přístup odepřen</AlertTitle>
        <AlertDescription>
          Sekce Report je dostupná vlastníkovi, administrátorovi nebo superadminovi.
        </AlertDescription>
      </Alert>
    );
  }

  const jobLink = (id: string | null | undefined) =>
    id ? (
      <Button variant="link" className="h-auto p-0 text-sm" asChild>
        <Link href={`/portal/jobs/${id}`}>Otevřít zakázku</Link>
      </Button>
    ) : null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto min-w-0">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Report aktivit</h1>
        <p className="portal-page-description text-sm mt-1">
          Audit změn v organizaci a přehled relací přihlášení (realtime z Firestore).
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filtry</CardTitle>
          <CardDescription>Užší výběr se aplikuje na načtené záznamy v záložce.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Osoba</Label>
            <Select value={employeeQ || "__all__"} onValueChange={(v) => setEmployeeQ(v === "__all__" ? "" : v)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Všichni" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všichni</SelectItem>
                {employeeFilterOptions.map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    <span className="truncate">{label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Typ akce (část řetězce)</Label>
            <Input
              className="min-h-[44px]"
              value={actionQ}
              onChange={(e) => setActionQ(e.target.value)}
              placeholder="např. job., document., task."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Modul</Label>
            <Input
              className="min-h-[44px]"
              value={moduleQ}
              onChange={(e) => setModuleQ(e.target.value)}
              placeholder="jobs, doklady, …"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Od</Label>
            <Input
              type="date"
              className="min-h-[44px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Do</Label>
            <Input
              type="date"
              className="min-h-[44px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rychlé filtry</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vše</SelectItem>
                <SelectItem value="auth">Přihlášení / odhlášení</SelectItem>
                <SelectItem value="docs">Doklady / soubory</SelectItem>
                <SelectItem value="jobs">Zakázky</SelectItem>
                <SelectItem value="expenses">Náklady</SelectItem>
                <SelectItem value="create">Vytvoření</SelectItem>
                <SelectItem value="update">Úpravy</SelectItem>
                <SelectItem value="delete">Smazání</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "activity" | "sessions")}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="activity" className="min-h-[44px]">
            Aktivity
          </TabsTrigger>
          <TabsTrigger value="sessions" className="min-h-[44px]">
            Relace
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {logsLoading ? (
                <div className="flex justify-center p-10">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[140px]">Čas</TableHead>
                        <TableHead className="min-w-[120px]">Osoba</TableHead>
                        <TableHead className="min-w-[160px]">Akce</TableHead>
                        <TableHead className="min-w-[100px]">Modul</TableHead>
                        <TableHead className="min-w-[140px]">Záznam</TableHead>
                        <TableHead className="min-w-[180px]">Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map((row) => (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setDetailRow(row)}
                        >
                          <TableCell className="text-sm whitespace-nowrap align-top">
                            {formatDt(row.createdAt)}
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            <div className="flex flex-col min-w-0 max-w-[10rem]">
                              <span className="font-medium truncate">
                                {row.employeeName ?? "—"}
                              </span>
                              <span className="text-xs text-muted-foreground truncate">
                                {row.employeeEmail ?? row.userId?.slice(0, 8) ?? ""}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant="outline" className="text-[10px] font-normal max-w-[14rem] truncate">
                              {row.actionType ?? "—"}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {row.actionLabel}
                            </p>
                          </TableCell>
                          <TableCell className="align-top text-sm text-muted-foreground">
                            {row.sourceModule ?? "—"}
                          </TableCell>
                          <TableCell className="align-top text-sm max-w-[12rem]">
                            <span className="line-clamp-2 font-medium">
                              {row.entityName || row.entityId || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="align-top text-sm max-w-[16rem]">
                            <p className="line-clamp-2 text-muted-foreground">
                              {row.details ?? "—"}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="p-4 border-t flex flex-wrap gap-2 justify-between items-center">
                <p className="text-xs text-muted-foreground">
                  Zobrazeno až {Math.min(listLimit, MAX_EXPORT)} posledních událostí (sestupně podle času).
                </p>
                {listLimit < MAX_EXPORT ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => setListLimit((n) => Math.min(n + PAGE_LIMIT_STEP, MAX_EXPORT))}
                  >
                    Načíst další
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {sessionsLoading ? (
                <div className="flex justify-center p-10">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Přihlášen od</TableHead>
                        <TableHead>Odhlášen</TableHead>
                        <TableHead>Čas relace</TableHead>
                        <TableHead>Osoba</TableHead>
                        <TableHead>Stav</TableHead>
                        <TableHead>Zařízení</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSessions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {formatDt(row.loginAt)}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {row.isActive ? "—" : formatDt(row.logoutAt)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.isActive
                              ? `Probíhá (od ${formatDt(row.loginAt)})`
                              : formatDuration(row.durationSeconds ?? undefined)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="max-w-[10rem] truncate">{row.employeeName}</div>
                          </TableCell>
                          <TableCell>
                            {row.isActive ? (
                              <Badge className="bg-emerald-600">Aktivní</Badge>
                            ) : (
                              <Badge variant="secondary">Ukončeno</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.deviceType ?? "—"} · {row.source ?? "web"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="p-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  disabled={listLimit >= MAX_EXPORT}
                  onClick={() => setListLimit((n) => Math.min(n + PAGE_LIMIT_STEP, MAX_EXPORT))}
                >
                  Načíst další relace
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail aktivity</DialogTitle>
          </DialogHeader>
          {detailRow ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Čas: </span>
                {formatDt(detailRow.createdAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Akce: </span>
                {detailRow.actionType} — {detailRow.actionLabel}
              </p>
              <p>
                <span className="text-muted-foreground">Entita: </span>
                {detailRow.entityType}{" "}
                {detailRow.entityId ? `(${detailRow.entityId})` : ""}
              </p>
              {detailRow.entityName ? (
                <p>
                  <span className="text-muted-foreground">Název: </span>
                  {detailRow.entityName}
                </p>
              ) : null}
              {detailRow.details ? (
                <p className="whitespace-pre-wrap break-words">{detailRow.details}</p>
              ) : null}
              {detailRow.route ? (
                <p>
                  <span className="text-muted-foreground">Route: </span>
                  {detailRow.route}
                </p>
              ) : null}
              {detailRow.metadata && Object.keys(detailRow.metadata).length ? (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-48">
                  {JSON.stringify(detailRow.metadata, null, 2)}
                </pre>
              ) : null}
              {(detailRow.metadata as { jobId?: string } | null)?.jobId
                ? jobLink((detailRow.metadata as { jobId?: string }).jobId)
                : detailRow.entityType === "job" && detailRow.entityId
                  ? jobLink(detailRow.entityId)
                  : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
