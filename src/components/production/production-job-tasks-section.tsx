"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
import { formatDateCs, formatTimeCs } from "@/lib/production-qr/format-datetime-cs";
import { VYROBA_CARD } from "@/lib/production-mobile-ui";
import { buildProductionQrTasksPdf } from "@/lib/production-qr/production-qr-tasks-pdf";
import {
  ProductionTaskFormDialog,
  type ProductionTaskFormValues,
} from "@/components/production/production-task-form-dialog";
import { ProductionCopyTasksDialog } from "@/components/production/production-copy-tasks-dialog";
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

type TaskRow = {
  id: string;
  name: string;
  description?: string | null;
  nameUk?: string | null;
  descriptionUk?: string | null;
  activityType?: string | null;
  status: string;
  active: boolean;
  scanUrl: string | null;
  sortOrder: number;
};

type ReportSession = {
  entryId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  isRunning: boolean;
  endedReason?: string | null;
};

const END_REASON_LABEL: Record<string, string> = {
  manual_stop: "Ruční ukončení",
  switched_task: "Přepnutí úkolu",
  attendance_clock_out: "Odchod z práce",
  attendance_lunch: "Oběd",
  attendance_break: "Přestávka / tarif",
  admin_edit: "Úprava vedením",
};

type ReportTask = {
  taskId: string;
  taskName: string;
  totalSeconds: number;
  byEmployee: {
    employeeId: string;
    employeeName: string;
    seconds: number;
    sessions: ReportSession[];
  }[];
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

const emptyForm = (): ProductionTaskFormValues => ({
  name: "",
  description: "",
  nameUk: "",
  descriptionUk: "",
  activityType: "",
});

export function ProductionJobTasksSection({ jobId, jobDisplayName, canManage, getToken }: Props) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [report, setReport] = useState<{ totalSeconds: number; byTask: ReportTask[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrTask, setQrTask] = useState<TaskRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [deleteTask, setDeleteTask] = useState<TaskRow | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPreselect, setCopyPreselect] = useState<string[] | undefined>();
  const [pdfMode, setPdfMode] = useState(false);
  const [pdfSelected, setPdfSelected] = useState<Set<string>>(new Set());

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

  const saveTask = async (values: ProductionTaskFormValues, taskId?: string) => {
    setBusy(true);
    try {
      const token = await getToken();
      const payload = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        nameUk: values.nameUk.trim() || null,
        descriptionUk: values.descriptionUk.trim() || null,
        activityType: values.activityType.trim() || null,
      };
      if (taskId) {
        const res = await fetch(
          `/api/company/production/tasks/${encodeURIComponent(taskId)}?jobId=${encodeURIComponent(jobId)}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Uložení selhalo");
      } else {
        const res = await fetch("/api/company/production/tasks", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, ...payload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Vytvoření selhalo");
      }
      setCreateOpen(false);
      setEditTask(null);
      await load();
      toast({ title: taskId ? "Úkol uložen" : "Úkol vytvořen" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : undefined,
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

  const confirmDelete = async () => {
    if (!deleteTask) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/production/tasks/${encodeURIComponent(deleteTask.id)}?jobId=${encodeURIComponent(jobId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Smazání selhalo");
      setDeleteTask(null);
      await load();
      toast({
        title: data.archived ? "Úkol archivován" : "Úkol odstraněn",
        description: data.archived
          ? "Historie pracovního času zůstala zachována."
          : undefined,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async (subset: TaskRow[]) => {
    const withUrl = subset.filter((t) => t.scanUrl);
    if (withUrl.length === 0) {
      toast({ variant: "destructive", title: "Žádné QR k exportu" });
      return;
    }
    setBusy(true);
    try {
      const QRCode = await import("qrcode");
      const tasksForPdf = await Promise.all(
        withUrl.map(async (t) => ({
          name: t.name,
          nameUk: t.nameUk,
          description: t.description,
          descriptionUk: t.descriptionUk,
          scanUrl: t.scanUrl!,
          status: t.status,
          qrDataUrl: await QRCode.toDataURL(t.scanUrl!, {
            width: 512,
            margin: 1,
            errorCorrectionLevel: "M",
          }),
        }))
      );
      const blob = await buildProductionQrTasksPdf({
        jobNumberLabel: jobId.slice(0, 8),
        jobName: jobDisplayName,
        tasks: tasksForPdf,
      });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) {
        w.addEventListener("load", () => {
          try {
            w.print();
          } catch {
            /* user may print manually */
          }
        });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `qr-ukoly-${jobId.slice(0, 8)}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPdfMode(false);
      setPdfSelected(new Set());
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export PDF selhal",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
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

  const editInitial = useMemo((): ProductionTaskFormValues => {
    if (!editTask) return emptyForm();
    return {
      name: editTask.name,
      description: editTask.description ?? "",
      nameUk: editTask.nameUk ?? "",
      descriptionUk: editTask.descriptionUk ?? "",
      activityType: editTask.activityType ?? "",
    };
  }, [editTask]);

  return (
    <>
      <Card className={VYROBA_CARD}>
        <CardHeader className="flex flex-col gap-2 border-b border-slate-100 max-lg:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base text-slate-900 max-lg:text-slate-50">
            Výrobní úkoly (QR čas)
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {canManage && tasks.length > 0 ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={busy}
                  onClick={() => {
                    setPdfMode(true);
                    setPdfSelected(new Set(tasks.map((t) => t.id)));
                  }}
                >
                  <FileDown className="h-3.5 w-3.5" /> Tisk QR úkolů / Export PDF
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    setCopyPreselect(undefined);
                    setCopyOpen(true);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Kopírovat úkoly
                </Button>
              </>
            ) : null}
            {canManage ? (
              <Button type="button" size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Úkol
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          {pdfMode ? (
            <div className="rounded-md border border-orange-200 bg-orange-50/80 p-3 space-y-2 dark:border-orange-800 dark:bg-orange-950/40">
              <p className="text-sm font-medium">Export PDF — vyberte úkoly (max. 3 na stránku A4)</p>
              {tasks.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={pdfSelected.has(t.id)}
                    onCheckedChange={() =>
                      setPdfSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(t.id)) n.delete(t.id);
                        else n.add(t.id);
                        return n;
                      })
                    }
                  />
                  {t.name}
                </label>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void exportPdf(tasks.filter((t) => pdfSelected.has(t.id)))
                  }
                >
                  Export vybraných
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void exportPdf(tasks)}>
                  Export všech
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPdfMode(false)}>
                  Zrušit
                </Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím nejsou definované výrobní úkoly. {canManage ? "Přidejte první úkol a vytiskněte QR." : ""}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2.5 max-lg:border-slate-600 max-lg:bg-slate-800/90 max-lg:text-slate-100"
                >
                  {t.scanUrl ? (
                    <button
                      type="button"
                      className="shrink-0 rounded bg-white p-0.5"
                      onClick={() => setQrTask(t)}
                      aria-label="QR kód"
                    >
                      <QRCodeSVG value={t.scanUrl} size={56} />
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-semibold text-sm leading-tight line-clamp-2">{t.name}</p>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>
                    {t.activityType ? (
                      <p className="text-[11px] text-muted-foreground">{t.activityType}</p>
                    ) : null}
                    {t.description ? (
                      <p className="line-clamp-2 text-xs text-slate-600 max-lg:text-slate-300">
                        {t.description}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setQrTask(t)}>
                        <QrCode className="h-3 w-3 mr-0.5" /> QR
                      </Button>
                      {canManage ? (
                        <>
                          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditTask(t)}>
                            <Pencil className="h-3 w-3 mr-0.5" /> Upravit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setCopyPreselect([t.id]);
                              setCopyOpen(true);
                            }}
                          >
                            <Copy className="h-3 w-3 mr-0.5" /> Kopírovat
                          </Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void regenerateQr(t.id)}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600" onClick={() => setDeleteTask(t)}>
                            <Trash2 className="h-3 w-3 mr-0.5" /> Smazat
                          </Button>
                        </>
                      ) : null}
                    </div>
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
                <div
                  key={row.taskId}
                  className="space-y-2 rounded-md bg-slate-50 p-3 text-sm max-lg:bg-slate-800/80 max-lg:text-slate-100"
                >
                  <p className="font-medium max-lg:text-slate-50">
                    {row.taskName}
                    <span className="font-normal text-muted-foreground max-lg:text-slate-400">
                      {" "}
                      · Celkem {formatDurationCs(row.totalSeconds)}
                    </span>
                  </p>
                  {row.byEmployee.map((e) => (
                    <div
                      key={e.employeeId}
                      className="space-y-1 border-l-2 border-slate-200 pl-2 max-lg:border-slate-600"
                    >
                      <p className="font-medium text-slate-800 max-lg:text-slate-200">
                        {e.employeeName} · {formatDurationCs(e.seconds)}
                      </p>
                      {(e.sessions ?? []).map((s) => (
                        <div key={s.entryId} className="text-muted-foreground text-xs pl-2 space-y-0.5">
                          <p>{formatDateCs(s.startedAt)}</p>
                          <p>
                            Od: {formatTimeCs(s.startedAt)}
                            {" · "}
                            Do: {s.isRunning ? "právě běží" : s.endedAt ? formatTimeCs(s.endedAt) : "—"}
                            {" · "}
                            {formatDurationCs(s.durationSeconds)}
                            {!s.isRunning && s.endedReason ? (
                              <>
                                {" "}
                                · Ukončeno: {END_REASON_LABEL[s.endedReason] ?? s.endedReason}
                              </>
                            ) : null}
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ProductionTaskFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Nový výrobní úkol"
        initial={emptyForm()}
        busy={busy}
        getToken={getToken}
        onSubmit={(v) => saveTask(v)}
      />

      <ProductionTaskFormDialog
        open={!!editTask}
        onOpenChange={(o) => !o && setEditTask(null)}
        title="Upravit výrobní úkol"
        initial={editInitial}
        busy={busy}
        getToken={getToken}
        onSubmit={(v) => saveTask(v, editTask?.id)}
      />

      <ProductionCopyTasksDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        sourceJobId={jobId}
        tasks={tasks.map((t) => ({ id: t.id, name: t.name }))}
        preselectedIds={copyPreselect}
        getToken={getToken}
        onCopied={() => void load()}
      />

      <AlertDialog open={!!deleteTask} onOpenChange={(o) => !o && setDeleteTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat úkol „{deleteTask?.name}“?</AlertDialogTitle>
            <AlertDialogDescription>
              Úkol s evidovaným pracovním časem bude archivován (historie zůstane). Úkol bez historie
              bude odstraněn z aktivního seznamu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Potvrdit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {qrTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          onClick={() => setQrTask(null)}
        >
          <div
            className="max-w-sm rounded-lg bg-white p-4 shadow-lg dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold mb-2">{qrTask.name}</p>
            {qrTask.scanUrl ? (
              <div className="flex flex-col items-center gap-3">
                <QRCodeSVG value={qrTask.scanUrl} size={240} />
                <Button type="button" className="w-full gap-2" onClick={printQr}>
                  <Printer className="h-4 w-4" /> Vytisknout QR
                </Button>
              </div>
            ) : null}
            <Button type="button" variant="ghost" className="w-full mt-2" onClick={() => setQrTask(null)}>
              Zavřít
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
