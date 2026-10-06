"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Plus, Printer, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";

type TaskRow = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  active: boolean;
  scanUrl: string | null;
  sortOrder: number;
};

type ReportTask = {
  taskId: string;
  taskName: string;
  totalSeconds: number;
  byEmployee: { employeeId: string; employeeName: string; seconds: number }[];
};

type Props = {
  jobId: string;
  jobDisplayName: string;
  canManage: boolean;
  getToken: () => Promise<string>;
};

const STATUS_LABEL: Record<string, string> = {
  new: "Nový",
  in_progress: "Rozpracovaný",
  done: "Dokončený",
};

export function ProductionJobTasksSection({ jobId, jobDisplayName, canManage, getToken }: Props) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [report, setReport] = useState<{ totalSeconds: number; byTask: ReportTask[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [qrTask, setQrTask] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/company/production/tasks?jobId=${encodeURIComponent(jobId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/company/production/job-time-report?jobId=${encodeURIComponent(jobId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const tData = await tRes.json();
      const rData = await rRes.json();
      if (tData.ok) setTasks(tData.tasks ?? []);
      if (rData.ok) setReport(rData.report ?? null);
    } finally {
      setLoading(false);
    }
  }, [getToken, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTask = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/company/production/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chyba");
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      await load();
      toast({ title: "Úkol vytvořen" });
    } catch (e) {
      toast({
        title: "Nepodařilo se vytvořit úkol",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const regenerateQr = async (taskId: string) => {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/production/tasks/${encodeURIComponent(taskId)}/regenerate-qr?jobId=${encodeURIComponent(jobId)}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chyba");
      await load();
      toast({ title: "Nový QR kód vygenerován" });
    } catch (e) {
      toast({
        title: "Regenerace QR selhala",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const markDone = async (taskId: string) => {
    const token = await getToken();
    await fetch(
      `/api/company/production/tasks/${encodeURIComponent(taskId)}?jobId=${encodeURIComponent(jobId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      }
    );
    await load();
  };

  const printQr = () => {
    if (!qrTask?.scanUrl) return;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html><html><head><title>QR ${qrTask.name}</title>
      <style>body{font-family:system-ui;padding:24px;text-align:center} h1{font-size:18px} h2{font-size:22px;margin:8px 0}</style></head><body>
      <p>RAJMONDATA</p>
      <h1>Zakázka: ${jobDisplayName.replace(/</g, "")}</h1>
      <h2>Úkol: ${qrTask.name.replace(/</g, "")}</h2>
      <div id="q"></div>
      <p style="margin-top:16px">Naskenujte pro zahájení práce.</p>
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"><\/script>
      <script>QRCode.toCanvas(document.getElementById('q'), ${JSON.stringify(qrTask.scanUrl)}, {width:280})<\/script>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <>
      <Card className="border-slate-200 bg-white">
        <CardHeader className="border-b border-slate-100 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Výrobní úkoly (QR čas)</CardTitle>
          {canManage ? (
            <Button type="button" size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Úkol
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím nejsou definované výrobní úkoly. {canManage ? "Přidejte první úkol a vytiskněte QR." : ""}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-slate-200 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </p>
                    </div>
                    {t.scanUrl ? (
                      <QRCodeSVG value={t.scanUrl} size={72} className="shrink-0 rounded bg-white p-1" />
                    ) : null}
                  </div>
                  {t.description ? (
                    <p className="text-sm text-slate-600 line-clamp-2">{t.description}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 mt-auto">
                    <Button type="button" size="sm" variant="outline" onClick={() => setQrTask(t)}>
                      <QrCode className="h-3.5 w-3.5 mr-1" /> QR
                    </Button>
                    {canManage ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void regenerateQr(t.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        {t.status !== "done" ? (
                          <Button type="button" size="sm" variant="secondary" onClick={() => void markDone(t.id)}>
                            Dokončit
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {report ? (
            <div className="border-t pt-4 space-y-3">
              <p className="font-semibold text-sm">Čas ve výrobě</p>
              <p className="text-sm text-muted-foreground">
                Celkem: {formatDurationCs(report.totalSeconds)}
              </p>
              {report.byTask.map((row) => (
                <div key={row.taskId} className="rounded-md bg-slate-50 p-3 text-sm space-y-1">
                  <p className="font-medium">
                    {row.taskName} — {formatDurationCs(row.totalSeconds)}
                  </p>
                  {row.byEmployee.map((e) => (
                    <p key={e.employeeId} className="text-muted-foreground pl-2">
                      {e.employeeName}: {formatDurationCs(e.seconds)}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nový výrobní úkol</DialogTitle>
          </DialogHeader>
          <Input placeholder="Název (např. Montáž oken)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Textarea placeholder="Popis (volitelné)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <DialogFooter>
            <Button type="button" disabled={busy} onClick={() => void createTask()}>
              Vytvořit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrTask} onOpenChange={(o) => !o && setQrTask(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrTask?.name}</DialogTitle>
          </DialogHeader>
          {qrTask?.scanUrl ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <QRCodeSVG value={qrTask.scanUrl} size={240} />
              <p className="text-xs text-center text-muted-foreground break-all">{qrTask.scanUrl}</p>
              <Button type="button" className="w-full gap-2" onClick={printQr}>
                <Printer className="h-4 w-4" /> Vytisknout QR
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
