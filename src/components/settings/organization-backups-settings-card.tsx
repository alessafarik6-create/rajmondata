"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, DatabaseBackup, AlertTriangle, RefreshCw } from "lucide-react";
import { buildRestoreConfirmationPhrase } from "@/lib/organization-backup/permissions";

type BackupRow = {
  id: string;
  backupType?: string;
  status?: string;
  createdAt?: string | { seconds?: number; _seconds?: number };
  completedAt?: string | { seconds?: number; _seconds?: number };
  sizeBytes?: number;
  recordCount?: number;
  fileCount?: number;
  progressPercent?: number;
  error?: string | null;
  recordCounts?: { byTopCollection?: Record<string, number> };
};

type Props = {
  companyId: string;
  organizationName: string;
  isOwner: boolean;
  isAdmin: boolean;
};

function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTs(ts?: string | { seconds?: number; _seconds?: number } | null): string {
  if (!ts) return "—";
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("cs-CZ");
  }
  const sec = ts.seconds ?? ts._seconds;
  if (sec == null) return "—";
  return new Date(sec * 1000).toLocaleString("cs-CZ");
}

function backupTypeLabel(t?: string): string {
  switch (t) {
    case "DAILY":
      return "Automatická (denní)";
    case "WEEKLY":
      return "Automatická (týdenní)";
    case "MONTHLY":
      return "Automatická (měsíční)";
    case "MANUAL":
      return "Manuální";
    case "PRE_RESTORE":
      return "Před obnovou";
    case "PRE_MIGRATION":
      return "Před migrací";
    case "EXPORT":
      return "Export";
    default:
      return t || "—";
  }
}

function statusBadge(status?: string) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="default">Hotovo</Badge>;
    case "CREATING":
    case "VERIFYING":
    case "RESTORING":
      return <Badge variant="secondary">Probíhá</Badge>;
    case "FAILED":
      return <Badge variant="destructive">Chyba</Badge>;
    case "PENDING_DELETION":
      return <Badge variant="outline">Ke smazání</Badge>;
    default:
      return <Badge variant="outline">{status || "—"}</Badge>;
  }
}

export function OrganizationBackupsSettingsCard({
  companyId,
  organizationName,
  isOwner,
  isAdmin,
}: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<BackupRow[]>([]);
  const [health, setHealth] = useState<"ok" | "error" | "running">("ok");
  const [detailRow, setDetailRow] = useState<BackupRow | null>(null);
  const [lastOk, setLastOk] = useState<string>("—");
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [restoring, setRestoring] = useState(false);

  const expectedPhrase = useMemo(
    () => buildRestoreConfirmationPhrase(organizationName),
    [organizationName]
  );

  const fetchList = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/backups", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Načtení selhalo.");
      setItems(data.items || []);
      const h = data.monitoring?.health;
      setHealth(h === "error" ? "error" : h === "running" ? "running" : "ok");
      const last = data.monitoring?.lastSuccessfulAt;
      setLastOk(formatTs(last));
    } catch (e) {
      toast({
        title: "Zálohy",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (isAdmin) void fetchList();
  }, [fetchList, isAdmin]);

  const createBackup = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/backups", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ backupType: "MANUAL" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Vytvoření selhalo.");
      toast({
        title: data.progress?.status === "COMPLETED" ? "Záloha dokončena" : "Záloha spuštěna",
        description: data.message,
      });
      await fetchList();
    } catch (e) {
      toast({ title: "Chyba", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const continueBackup = async (backupId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch(`/api/company/backups/${backupId}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchList();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isAdmin || !user) return;
    const running = items.some(
      (r) => r.status === "CREATING" || r.status === "VERIFYING" || r.status === "RESTORING"
    );
    if (!running) return;
    const t = window.setInterval(() => {
      void (async () => {
        const token = await user.getIdToken();
        for (const row of items) {
          if (row.status === "CREATING" || row.status === "VERIFYING") {
            await fetch(`/api/company/backups/${row.id}/run`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
        await fetchList();
      })();
    }, 12_000);
    return () => window.clearInterval(t);
  }, [items, isAdmin, user, fetchList]);

  const runRestore = async () => {
    if (!user || !restoreId) return;
    setRestoring(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/backups/${restoreId}/restore`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmationPhrase: confirmPhrase }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Obnova selhala.");
      toast({
        title: "Obnova dokončena",
        description: `Obnoveno ${data.restoredDocs ?? 0} záznamů, ${data.restoredFiles ?? 0} souborů. PRE_RESTORE: ${data.preRestoreBackupId}`,
      });
      setRestoreId(null);
      setConfirmPhrase("");
      await fetchList();
    } catch (e) {
      toast({ title: "Obnova", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            Zálohy organizace
          </CardTitle>
          <CardDescription>
            Logické zálohy dat a souborů firmy. Automatické běhy denně (retence 30 dní), týdně a
            měsíčně dle plánu cronu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Stav:{" "}
              {health === "ok" ? (
                <span className="text-green-600 font-medium">V pořádku</span>
              ) : health === "running" ? (
                <span className="text-amber-600 font-medium">Probíhá záloha…</span>
              ) : (
                <span className="text-destructive font-medium">Poslední záloha selhala</span>
              )}
            </span>
            <span>Poslední úspěšná: {lastOk}</span>
            <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Obnovit seznam
            </Button>
          </div>

          <Button onClick={() => void createBackup()} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Probíhá vytváření zálohy…
              </>
            ) : (
              "Vytvořit zálohu nyní"
            )}
          </Button>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Načítání…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Velikost</TableHead>
                    <TableHead>Záznamy</TableHead>
                    <TableHead>Soubory</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        Zatím žádné zálohy.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{formatTs(row.completedAt || row.createdAt)}</TableCell>
                        <TableCell>{backupTypeLabel(row.backupType)}</TableCell>
                        <TableCell>{formatBytes(row.sizeBytes ?? 0)}</TableCell>
                        <TableCell>{(row.recordCount ?? 0).toLocaleString("cs-CZ")}</TableCell>
                        <TableCell>{(row.fileCount ?? 0).toLocaleString("cs-CZ")}</TableCell>
                        <TableCell>{statusBadge(row.status)}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button variant="ghost" size="sm" onClick={() => setDetailRow(row)}>
                            Detail
                          </Button>
                          {(row.status === "CREATING" || row.status === "VERIFYING") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void continueBackup(row.id)}
                            >
                              Pokračovat
                              {row.progressPercent != null && row.progressPercent > 0
                                ? ` (${row.progressPercent} %)`
                                : ""}
                            </Button>
                          )}
                          {row.status === "COMPLETED" && isOwner && (
                            <Button variant="destructive" size="sm" onClick={() => setRestoreId(row.id)}>
                              Obnovit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Detail zálohy</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-foreground">
                {detailRow && (
                  <>
                    <p>
                      <strong>ID:</strong> {detailRow.id}
                    </p>
                    <p>
                      <strong>Datum:</strong> {formatTs(detailRow.completedAt || detailRow.createdAt)}
                    </p>
                    <p>
                      <strong>Záznamů:</strong> {(detailRow.recordCount ?? 0).toLocaleString("cs-CZ")}
                    </p>
                    <p>
                      <strong>Souborů:</strong> {(detailRow.fileCount ?? 0).toLocaleString("cs-CZ")}
                    </p>
                    <p>
                      <strong>Velikost:</strong> {formatBytes(detailRow.sizeBytes ?? 0)}
                    </p>
                    {detailRow.recordCounts?.byTopCollection && (
                      <ul className="mt-2 max-h-48 overflow-y-auto border rounded p-2 text-xs">
                        {Object.entries(detailRow.recordCounts.byTopCollection)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k, v]) => (
                            <li key={k} className="flex justify-between gap-2">
                              <span>{k}</span>
                              <span>{v.toLocaleString("cs-CZ")}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                    {detailRow.error && (
                      <p className="text-destructive text-xs">{detailRow.error}</p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zavřít</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!restoreId} onOpenChange={(o) => !o && setRestoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Obnova zálohy
            </AlertDialogTitle>
            <AlertDialogDescription>
              Obnova zálohy může změnit současná data organizace. Před obnovou se automaticky
              vytvoří záloha typu PRE_RESTORE.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="restore-phrase">Pro potvrzení napište: {expectedPhrase}</Label>
            <Input
              id="restore-phrase"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring || confirmPhrase.trim().toUpperCase() !== expectedPhrase}
              onClick={(e) => {
                e.preventDefault();
                void runRestore();
              }}
            >
              {restoring ? "Obnovuji…" : "Obnovit organizaci"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
