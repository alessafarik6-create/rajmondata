"use client";

import React, { useMemo } from "react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, collection, query, where, limit } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Wallet } from "lucide-react";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
import {
  formatKc,
  getPayableHours,
  getLoggedHours,
  getReviewLabel,
  moneyForBlock,
  sumMoneyForBlocks,
  sumPayableHoursForBlocks,
  sumPaidAdvances,
  thisMonthRange,
  thisWeekRange,
  todayRange,
  type AdvanceDoc,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JOB_TERMINAL_AUTO_APPROVAL_SOURCE } from "@/lib/job-terminal-auto-shared";

export default function EmployeeMoneyPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } =
    useDoc<any>(userRef);

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

  const hourlyRate = useMemo(() => {
    const fromEmp = Number(employeeDoc?.hourlyRate);
    const fromUser = Number(profile?.hourlyRate);
    if (Number.isFinite(fromEmp) && fromEmp > 0) return fromEmp;
    if (Number.isFinite(fromUser) && fromUser > 0) return fromUser;
    return 0;
  }, [employeeDoc?.hourlyRate, profile?.hourlyRate]);

  const blocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId]);

  const silentListen = { suppressGlobalPermissionError: true as const };

  const { data: blocksRaw, isLoading: blocksLoading, error: blocksError } =
    useCollection(blocksQuery, silentListen);

  const advancesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "advances"),
      where("employeeId", "==", employeeId),
      limit(200)
    );
  }, [firestore, companyId, employeeId]);

  const { data: advancesRaw, isLoading: advancesLoading, error: advancesError } =
    useCollection(advancesQuery, silentListen);

  const blocks = useMemo(() => {
    const raw = Array.isArray(blocksRaw) ? blocksRaw : [];
    return raw.map((b: any) => ({ ...b, id: String(b?.id ?? "") }));
  }, [blocksRaw]);

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

  const blocksMoney = blocks as WorkTimeBlockMoney[];

  const now = new Date();
  const tr = todayRange(now);
  const wr = thisWeekRange(now);
  const mr = thisMonthRange(now);

  const approvedHoursTotal = sumPayableHoursForBlocks(blocksMoney);
  const pendingHoursTotal = useMemo(() => {
    return (
      Math.round(
        blocksMoney
          .filter((b) => b.reviewStatus === "pending")
          .reduce((s, b) => s + getLoggedHours(b), 0) * 100
      ) / 100
    );
  }, [blocksMoney]);

  const earnedToday = sumMoneyForBlocks(blocksMoney, hourlyRate, tr);
  const earnedWeek = sumMoneyForBlocks(blocksMoney, hourlyRate, wr);
  const earnedMonth = sumMoneyForBlocks(blocksMoney, hourlyRate, mr);
  const earnedAll = sumMoneyForBlocks(blocksMoney, hourlyRate);

  const paidTotal = sumPaidAdvances(advances);
  const remaining = Math.max(0, Math.round((earnedAll - paidTotal) * 100) / 100);

  const sortedAdvances = useMemo(() => {
    return [...advances].sort((a, b) => b.date.localeCompare(a.date));
  }, [advances]);

  const sortedBlocks = useMemo(() => {
    return [...blocksMoney].sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
  }, [blocksMoney]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-black">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-black">Načítání profilu…</p>
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

  if (!companyId || !employeeId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Chybí data účtu</AlertTitle>
        <AlertDescription>
          Pro zobrazení peněz je potřeba být přiřazen k firmě jako zaměstnanec.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 pb-10 sm:px-0">
      <div className="flex items-start gap-3">
        <Wallet className="mt-1 h-8 w-8 shrink-0 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-black sm:text-3xl">Peníze</h1>
          <p className="mt-1 text-base text-slate-800">
            Přehled výdělku ze schválených hodin a záloh.
            {companyName && companyName !== "Organization"
              ? ` · ${companyName}`
              : ""}
          </p>
        </div>
      </div>

      {(blocksError || advancesError) && (
        <Alert
          className="border-amber-300 bg-amber-50 text-amber-950"
          variant="default"
        >
          <AlertCircle className="h-4 w-4 text-amber-800" />
          <AlertTitle>Část dat se nepodařila načíst</AlertTitle>
          <AlertDescription className="text-amber-950">
            {isFirestoreIndexError(blocksError) || isFirestoreIndexError(advancesError)
              ? "Databáze momentálně nemůže vrátit všechna data (index nebo dočasný problém). Součty níže mohou být neúplné — zkuste stránku později."
              : "Zkuste obnovit stránku. Pokud problém přetrvává, kontaktujte administrátora."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Hodinová sazba
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-black">
              {hourlyRate > 0 ? `${hourlyRate} Kč/h` : "—"}
            </p>
            {hourlyRate <= 0 && (
              <p className="mt-1 text-xs text-slate-800">
                Sazba není nastavena — domluvte se s administrátorem.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Schválené hodiny (celkem)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-black">
              {blocksLoading ? "…" : `${approvedHoursTotal} h`}
            </p>
            {!blocksLoading && pendingHoursTotal > 0 && (
              <p className="mt-1 text-xs font-medium text-amber-800">
                Čeká na schválení: {pendingHoursTotal} h
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Vyděláno (schválené × sazba)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="font-medium text-slate-700">Dnes</p>
              <p className="text-lg font-bold text-black">
                {blocksLoading ? "…" : formatKc(earnedToday)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Týden</p>
              <p className="text-lg font-bold text-black">
                {blocksLoading ? "…" : formatKc(earnedWeek)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Měsíc</p>
              <p className="text-lg font-bold text-black">
                {blocksLoading ? "…" : formatKc(earnedMonth)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Celkem</p>
              <p className="text-lg font-bold text-black">
                {blocksLoading ? "…" : formatKc(earnedAll)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-2 border-primary/25 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">Celkový přehled</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Celkem vyděláno
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {blocksLoading ? "…" : formatKc(earnedAll)}
            </p>
            <p className="text-xs text-slate-800">Jen schválené hodiny</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Celkem vyplaceno
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {advancesLoading ? "…" : formatKc(paidTotal)}
            </p>
            <p className="text-xs text-slate-800">Součet záloh se stavem zaplaceno</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Zbývá k vyplacení
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {blocksLoading || advancesLoading ? "…" : formatKc(remaining)}
            </p>
            <p className="text-xs text-emerald-900">
              vyděláno − vyplacené zálohy
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">Zálohy (výplaty)</CardTitle>
        </CardHeader>
        <CardContent>
          {advancesLoading ? (
            <div className="flex items-center gap-2 text-black">
              <Loader2 className="h-6 w-6 animate-spin" />
              Načítání…
            </div>
          ) : sortedAdvances.length === 0 ? (
            <p className="text-base text-slate-800">
              Zatím nemáte evidované žádné zálohy.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3 md:hidden">
                {sortedAdvances.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-bold text-black">
                        {formatKc(a.amount)}
                      </span>
                      <Badge
                        className={
                          a.status === "paid"
                            ? "bg-emerald-600 text-white hover:bg-emerald-600"
                            : "bg-red-600 text-white hover:bg-red-600"
                        }
                      >
                        {a.status === "paid" ? "Zaplaceno" : "Nezaplaceno"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-black">
                      Datum: {a.date || "—"}
                    </p>
                    {a.note ? (
                      <p className="mt-1 text-sm text-slate-800">{a.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-md border border-slate-200 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-black">Datum</TableHead>
                      <TableHead className="text-black">Částka</TableHead>
                      <TableHead className="text-black">Stav</TableHead>
                      <TableHead className="text-black">Poznámka</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAdvances.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium text-black">
                          {a.date || "—"}
                        </TableCell>
                        <TableCell className="font-bold text-black">
                          {formatKc(a.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              a.status === "paid"
                                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                                : "bg-red-600 text-white hover:bg-red-600"
                            }
                          >
                            {a.status === "paid" ? "Zaplaceno" : "Nezaplaceno"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs text-black">
                          {a.note || "—"}
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

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">
            Výkazy práce (přehled)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {blocksLoading ? (
            <div className="flex items-center gap-2 text-black">
              <Loader2 className="h-6 w-6 animate-spin" />
              Načítání…
            </div>
          ) : sortedBlocks.length === 0 ? (
            <p className="text-base text-slate-800">Žádné záznamy výkazu.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-3 lg:hidden">
                {sortedBlocks.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg border border-slate-300 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-black">{b.date}</span>
                      <Badge variant="secondary" className="font-semibold">
                        {getReviewLabel(b.reviewStatus)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-black">
                      {b.startTime} – {b.endTime} · zápis {b.hours ?? "—"} h ·
                      schváleno {getPayableHours(b)} h
                      {hourlyRate > 0 && getPayableHours(b) > 0
                        ? ` · ${formatKc(moneyForBlock(b, hourlyRate))}`
                        : ""}
                    </p>
                    {(b.reviewStatus === "adjusted" || b.reviewStatus === "approved") &&
                    (b.adminNote || b.adjustmentReason) ? (
                      <p className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900">
                        {b.adminNote ? (
                          <span className="block">
                            <span className="font-semibold">Poznámka:</span>{" "}
                            {b.adminNote}
                          </span>
                        ) : null}
                        {b.adjustmentReason ? (
                          <span className="mt-0.5 block">
                            <span className="font-semibold">Úprava:</span>{" "}
                            {b.adjustmentReason}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-slate-800">
                      {b.description || "—"}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-md border border-slate-200 lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-black">Datum</TableHead>
                      <TableHead className="text-black">Čas</TableHead>
                      <TableHead className="text-black">Hodiny</TableHead>
                      <TableHead className="text-black">Schv. h</TableHead>
                      <TableHead className="text-black">Stav</TableHead>
                      <TableHead className="text-black">Částka</TableHead>
                      <TableHead className="text-black">Popis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBlocks.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium text-black">
                          {b.date}
                        </TableCell>
                        <TableCell className="text-black">
                          {b.startTime} – {b.endTime}
                        </TableCell>
                        <TableCell className="text-black">{b.hours ?? "—"}</TableCell>
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
                        <TableCell className="whitespace-nowrap font-medium text-black">
                          {hourlyRate > 0 && getPayableHours(b) > 0
                            ? formatKc(moneyForBlock(b, hourlyRate))
                            : "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] text-black">
                          <span className="block truncate">
                            {b.description || "—"}
                          </span>
                          {(b.adminNote || b.adjustmentReason) && (
                            <span className="mt-1 block truncate text-xs text-slate-700">
                              {b.adminNote || b.adjustmentReason}
                            </span>
                          )}
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
    </div>
  );
}
