"use client";

import React, { useState, useEffect } from "react";
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
  Play,
  Square,
  Clock,
  Loader2,
  Coffee,
  UserCheck,
  History,
  Timer,
  Smartphone,
  Settings,
} from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

type AttendanceType = "check_in" | "break_start" | "break_end" | "check_out";

export default function AttendancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<AttendanceType | null>(null);

  useEffect(() => {
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
  }, []);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );

  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId;
  const { companyName } = useCompany();
  const orgLabel = companyName || companyId || "vaší organizace";

  const role = (profile as { role?: string } | null)?.role ?? "employee";
  const profileEmployeeId = (profile as { employeeId?: string } | null)?.employeeId;
  const isAttendancePrivileged =
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant";

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user) return null;

    const base = collection(firestore, "companies", companyId, "attendance");
    if (isAttendancePrivileged) {
      return query(base, orderBy("timestamp", "desc"), limit(100));
    }
    const ids = [...new Set([profileEmployeeId, user.uid].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    if (ids.length === 1) {
      return query(
        base,
        where("employeeId", "==", ids[0]),
        orderBy("timestamp", "desc"),
        limit(100)
      );
    }
    return query(
      base,
      where("employeeId", "in", ids),
      orderBy("timestamp", "desc"),
      limit(100)
    );
  }, [firestore, companyId, user, isAttendancePrivileged, profileEmployeeId]);

  const {
    data: historyData = [],
    isLoading: isHistoryLoading,
  } = useCollection(attendanceQuery);

  useEffect(() => {
    if (historyData && user) {
      const myLastAction = historyData.find((a: any) => a.employeeId === user.uid);
      if (myLastAction) {
        setLastAction(myLastAction.type as AttendanceType);
      }
    }
  }, [historyData, user]);

  const handleAttendanceAction = (type: AttendanceType) => {
    if (!user || !companyId) return;

    const colRef = collection(firestore, "companies", companyId, "attendance");

    addDocumentNonBlocking(colRef, {
      employeeId: user.uid,
      employeeName: profile?.displayName || user.email,
      type,
      timestamp: serverTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });

    const messages: Record<AttendanceType, string> = {
      check_in: "Příchod zaznamenán. Hezký pracovní den!",
      break_start: "Pauza zahájena. Odpočiňte si.",
      break_end: "Pauza ukončena. Zpět do práce.",
      check_out: "Odchod zaznamenán. Hezký zbytek dne!",
    };

    toast({
      title: "Docházka aktualizována",
      description: messages[type],
    });
  };

  const isAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

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

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Docházkový systém
          </h1>
          <div className="portal-page-description">
            Pracovní prostor:{" "}
            <span className="font-semibold text-primary">{orgLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {isAdmin && (
            <Link href="/portal/attendance/terminal/settings">
              <Button
                variant="outlineLight"
                size="icon"
                className="h-11 w-11 shrink-0"
                title="Nastavení terminálů"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
          )}

          <Link href="/portal/attendance/terminal" className="min-w-0">
            <Button className="gap-2 min-h-[44px] w-full sm:w-auto">
              <Smartphone className="w-4 h-4 shrink-0" />
              Mobilní terminál
            </Button>
          </Link>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-right min-w-[180px] hidden sm:block">
            <p className="text-4xl font-mono font-bold text-primary">
              {currentTime || "--:--:--"}
            </p>
            <p className="text-sm text-muted-foreground font-medium">
              {new Date().toLocaleDateString("cs-CZ", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="terminal" className="w-full overflow-hidden">
        <TabsList className="bg-white border border-slate-200 mb-4 sm:mb-6 flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger
            value="terminal"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <Timer className="w-4 h-4 shrink-0" />
            Terminál
          </TabsTrigger>

          <TabsTrigger
            value="history"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <History className="w-4 h-4 shrink-0" />
            Moje historie
          </TabsTrigger>

          {isAdmin && (
            <TabsTrigger
              value="admin"
              className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              Přehled týmu
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="terminal">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <Card className="lg:col-span-2 min-w-0">
              <CardHeader>
                <CardTitle>Docházkový terminál</CardTitle>
                <CardDescription>
                  Zaznamenejte svůj příchod, pauzu nebo odchod kliknutím na
                  příslušné tlačítko.
                </CardDescription>
              </CardHeader>

              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-6">
                <Button
                  size="lg"
                  disabled={
                    lastAction === "check_in" || lastAction === "break_end"
                  }
                  className="h-24 text-xl font-bold bg-emerald-600 hover:bg-emerald-700 transition-all gap-3"
                  onClick={() => handleAttendanceAction("check_in")}
                >
                  <Play className="w-6 h-6 fill-white" />
                  Přihlásit příchod
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={
                    lastAction !== "check_in" && lastAction !== "break_end"
                  }
                  className="h-24 text-xl font-bold border-amber-500 text-amber-500 hover:bg-amber-500/10 transition-all gap-3"
                  onClick={() => handleAttendanceAction("break_start")}
                >
                  <Coffee className="w-6 h-6" />
                  Zahájit pauzu
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={lastAction !== "break_start"}
                  className="h-24 text-xl font-bold border-blue-500 text-blue-500 hover:bg-blue-500/10 transition-all gap-3"
                  onClick={() => handleAttendanceAction("break_end")}
                >
                  <Clock className="w-6 h-6" />
                  Ukončit pauzu
                </Button>

                <Button
                  size="lg"
                  variant="destructive"
                  disabled={
                    lastAction === "check_out" ||
                    !lastAction ||
                    lastAction === "break_start"
                  }
                  className="h-24 text-xl font-bold transition-all gap-3"
                  onClick={() => handleAttendanceAction("check_out")}
                >
                  <Square className="w-6 h-6 fill-white" />
                  Odhlásit odchod
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-surface border-border shadow-xl">
              <CardHeader>
                <CardTitle>Aktuální stav</CardTitle>
                <CardDescription>Váš poslední záznam v systému</CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col items-center justify-center py-10 space-y-6">
                <div
                  className={`w-32 h-32 rounded-full border-4 flex items-center justify-center transition-all ${
                    lastAction === "check_in" || lastAction === "break_end"
                      ? "border-emerald-500 shadow-2xl shadow-emerald-500/20 animate-pulse"
                      : "border-muted"
                  }`}
                >
                  <Clock
                    className={`w-12 h-12 ${
                      lastAction === "check_in" || lastAction === "break_end"
                        ? "text-emerald-500"
                        : "text-muted"
                    }`}
                  />
                </div>

                <div className="text-center">
                  <h3 className="text-2xl font-bold capitalize">
                    {lastAction === "check_in"
                      ? "Pracujete"
                      : lastAction === "break_start"
                      ? "Na pauze"
                      : lastAction === "break_end"
                      ? "Pracujete"
                      : lastAction === "check_out"
                      ? "Mimo službu"
                      : "Nezahájeno"}
                  </h3>

                  <div className="text-muted-foreground mt-1">
                    Poslední akce:{" "}
                    {lastAction ? getStatusBadge(lastAction) : "Žádná"}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card className="bg-surface border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Moje historie docházky</CardTitle>
                <CardDescription>
                  Záznamy vašich příchodů a odchodů
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent>
              {isHistoryLoading ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : historyData &&
                historyData.filter((a: any) => a.employeeId === user?.uid)
                  .length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>Datum</TableHead>
                      <TableHead>Čas</TableHead>
                      <TableHead>Typ akce</TableHead>
                      <TableHead className="text-right">Terminál</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {historyData
                      .filter((a: any) => a.employeeId === user?.uid)
                      .slice(0, 20)
                      .map((row: any, i: number) => (
                        <TableRow
                          key={i}
                          className="border-border hover:bg-muted/30"
                        >
                          <TableCell className="font-medium">
                            {row.timestamp?.toDate
                              ? row.timestamp
                                  .toDate()
                                  .toLocaleDateString("cs-CZ")
                              : "Dnes"}
                          </TableCell>

                          <TableCell>
                            {row.timestamp?.toDate
                              ? row.timestamp.toDate().toLocaleTimeString(
                                  "cs-CZ",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "--:--"}
                          </TableCell>

                          <TableCell>{getStatusBadge(row.type)}</TableCell>

                          <TableCell className="text-right text-muted-foreground text-xs">
                            {row.terminalId || "Web"}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  Zatím nemáte žádné záznamy docházky.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin">
            <Card className="bg-surface border-border">
              <CardHeader>
                <CardTitle>Celkový přehled týmu</CardTitle>
                <CardDescription>
                  Poslední záznamy všech zaměstnanců ({orgLabel})
                </CardDescription>
              </CardHeader>

              <CardContent>
                {isHistoryLoading ? (
                  <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
                      {historyData.slice(0, 30).map((row: any, i: number) => (
                        <TableRow
                          key={i}
                          className="border-border hover:bg-muted/30"
                        >
                          <TableCell className="font-semibold">
                            {row.employeeName || row.employeeId}
                          </TableCell>

                          <TableCell>
                            {row.timestamp?.toDate
                              ? row.timestamp
                                  .toDate()
                                  .toLocaleDateString("cs-CZ")
                              : "Dnes"}
                          </TableCell>

                          <TableCell>
                            {row.timestamp?.toDate
                              ? row.timestamp.toDate().toLocaleTimeString(
                                  "cs-CZ",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "--:--"}
                          </TableCell>

                          <TableCell>{getStatusBadge(row.type)}</TableCell>

                          <TableCell className="text-right text-muted-foreground text-xs italic">
                            {row.terminalId || "Web"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-16 text-muted-foreground">
                    Zatím nejsou záznamy docházky.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
