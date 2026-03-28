"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { useFirestore, useMemoFirebase, useDoc, useCollection } from "@/firebase";
import { doc, collection, query, limit, where } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { formatKc } from "@/lib/employee-money";
import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  NO_JOB_SEGMENT_JOB_ID,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";
import {
  effectiveSegmentDurationHours,
  type WorkSegmentClient,
} from "@/lib/work-segment-client";
import { Loader2, Pencil, Trash2, Save } from "lucide-react";

type UserLike = { getIdToken: () => Promise<string> };

type EditableSplit = {
  key: string;
  segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
  segmentId: string;
  jobId: string;
  jobName: string;
  hoursStr: string;
  lineNote: string;
};

function tsLabel(v: unknown): string {
  if (!v) return "—";
  if (v instanceof Date) return v.toLocaleString("cs-CZ");
  if (typeof v === "object" && v !== null && "toDate" in v) {
    const fn = (v as { toDate?: () => Date }).toDate;
    if (typeof fn === "function") {
      try {
        return fn.call(v).toLocaleString("cs-CZ");
      } catch {
        return "—";
      }
    }
  }
  return "—";
}

function inferSegmentType(row: Record<string, unknown>): string {
  const st = String(row.segmentType ?? "").trim();
  if (st === DAILY_REPORT_ROW_SOURCE_MANUAL || st === DAILY_REPORT_ROW_SOURCE_TERMINAL) {
    return st;
  }
  const sid = row.segmentId;
  if (sid === null || sid === undefined || String(sid).trim() === "") {
    return DAILY_REPORT_ROW_SOURCE_MANUAL;
  }
  return DAILY_REPORT_ROW_SOURCE_TERMINAL;
}

function splitsFromReport(report: Record<string, unknown> | null | undefined): EditableSplit[] {
  const raw = report?.segmentJobSplits;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const row = item as Record<string, unknown>;
    const st = inferSegmentType(row) as EditableSplit["segmentType"];
    const sid =
      st === DAILY_REPORT_ROW_SOURCE_MANUAL
        ? ""
        : String(row.segmentId ?? "").trim();
    const jid = String(row.jobId ?? "").trim();
    const jobId = isNoJobSegmentJobId(jid) ? NO_JOB_SEGMENT_JOB_ID : jid;
    const hours =
      typeof row.hours === "number" && Number.isFinite(row.hours) ? row.hours : 0;
    return {
      key: `r-${i}-${sid || "m"}`,
      segmentType: st,
      segmentId: sid,
      jobId,
      jobName: typeof row.jobName === "string" ? row.jobName : "",
      hoursStr: hours > 0 ? String(hours).replace(".", ",") : "",
      lineNote: typeof row.lineNote === "string" ? row.lineNote : "",
    };
  });
}

function parseHoursLocal(s: string): number | null {
  const t = String(s).trim().replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function AdminDailyWorkReportDetailSheet(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  employeeId: string;
  date: string;
  user: UserLike;
}) {
  const { open, onOpenChange, companyId, employeeId, date, user } = props;
  const firestore = useFirestore();
  const { toast } = useToast();

  const rid = `${employeeId}__${date}`;
  const reportRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, "companies", companyId, "daily_work_reports", rid)
        : null,
    [firestore, companyId, rid]
  );

  const { data: report, isLoading: reportLoading } = useDoc<Record<string, unknown>>(reportRef);

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc } = useDoc<Record<string, unknown>>(employeeRef);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "jobs"), limit(400));
  }, [firestore, companyId]);
  const { data: jobsRaw = [] } = useCollection(jobsQuery);

  const segmentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !date) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      where("date", "==", date),
      limit(120)
    );
  }, [firestore, companyId, employeeId, date]);
  const { data: segmentsRaw = [] } = useCollection(segmentsQuery);

  const jobsOptions = useMemo(() => {
    const list = (Array.isArray(jobsRaw) ? jobsRaw : []) as { id?: string; name?: string }[];
    return list
      .map((j) => ({
        id: String(j.id ?? ""),
        name: String(j.name ?? j.id ?? "").trim() || String(j.id ?? ""),
      }))
      .filter((j) => j.id);
  }, [jobsRaw]);

  const jobsById = useMemo(() => new Map(jobsOptions.map((j) => [j.id, j])), [jobsOptions]);

  const jobHourlyById = useMemo(() => {
    const list = (Array.isArray(jobsRaw) ? jobsRaw : []) as Record<string, unknown>[];
    const m = new Map<string, number>();
    for (const j of list) {
      const id = String(j.id ?? "").trim();
      if (!id) continue;
      const hr = Number(j.hourlyRate);
      if (Number.isFinite(hr) && hr > 0) m.set(id, hr);
    }
    return m;
  }, [jobsRaw]);

  const [rows, setRows] = useState<EditableSplit[]>([]);
  const [note, setNote] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteRowKey, setDeleteRowKey] = useState<string | null>(null);
  const [deleteWholeOpen, setDeleteWholeOpen] = useState(false);
  const [deletingWhole, setDeletingWhole] = useState(false);

  useEffect(() => {
    if (!open || !report) return;
    setRows(splitsFromReport(report));
    setNote(typeof report.note === "string" ? report.note : "");
    setDescription(typeof report.description === "string" ? report.description : "");
  }, [open, report]);

  const empHourly = useMemo(() => {
    const n = Number(employeeDoc?.hourlyRate);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [employeeDoc]);

  const tariffHoursDay = useMemo(() => {
    const segs = (Array.isArray(segmentsRaw) ? segmentsRaw : []) as WorkSegmentClient[];
    let s = 0;
    for (const seg of segs) {
      if (seg.closed !== true) continue;
      if (String(seg.sourceType || "") !== "tariff") continue;
      s += effectiveSegmentDurationHours(seg);
    }
    return Math.round(s * 100) / 100;
  }, [segmentsRaw]);

  const terminalHoursSplits = useMemo(
    () => rows.filter((r) => r.segmentType === DAILY_REPORT_ROW_SOURCE_TERMINAL),
    [rows]
  );
  const manualHoursSplits = useMemo(
    () => rows.filter((r) => r.segmentType === DAILY_REPORT_ROW_SOURCE_MANUAL),
    [rows]
  );

  const sumTerminalHours = useMemo(() => {
    let s = 0;
    for (const r of terminalHoursSplits) {
      const h = parseHoursLocal(r.hoursStr);
      if (h != null) s += h;
    }
    return Math.round(s * 100) / 100;
  }, [terminalHoursSplits]);

  const sumManualHours = useMemo(() => {
    let s = 0;
    for (const r of manualHoursSplits) {
      const h = parseHoursLocal(r.hoursStr);
      if (h != null) s += h;
    }
    return Math.round(s * 100) / 100;
  }, [manualHoursSplits]);

  const totalHours = useMemo(
    () => Math.round((sumTerminalHours + sumManualHours) * 100) / 100,
    [sumTerminalHours, sumManualHours]
  );

  const rowAmountHint = useCallback(
    (r: EditableSplit) => {
      const h = parseHoursLocal(r.hoursStr);
      if (h == null || h <= 0) return 0;
      let useRate = empHourly;
      if (!isNoJobSegmentJobId(r.jobId)) {
        const jr = jobHourlyById.get(r.jobId);
        if (jr != null && jr > 0) useRate = jr;
      }
      const rate = Number.isFinite(useRate) && useRate > 0 ? useRate : 0;
      return Math.round(h * rate * 100) / 100;
    },
    [empHourly, jobHourlyById]
  );

  const statusBadge = (s: string | undefined) => {
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

  const buildPayloadSplits = () => {
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const h = parseHoursLocal(r.hoursStr);
      if (h == null) continue;
      const jid = isNoJobSegmentJobId(r.jobId) ? NO_JOB_SEGMENT_JOB_ID : r.jobId.trim();
      const jMeta = !isNoJobSegmentJobId(jid) ? jobsById.get(jid) : undefined;
      const o: Record<string, unknown> = {
        segmentType: r.segmentType,
        segmentId: r.segmentType === DAILY_REPORT_ROW_SOURCE_MANUAL ? null : r.segmentId.trim(),
        jobId: jid,
        jobName: jMeta?.name ?? (r.jobName.trim() || null),
        hours: h,
      };
      if (r.lineNote.trim()) o.lineNote = r.lineNote.trim();
      out.push(o);
    }
    return out;
  };

  const save = async () => {
    if (!user || !companyId) return;
    const payloadSplits = buildPayloadSplits();
    if (payloadSplits.length === 0) {
      toast({
        variant: "destructive",
        title: "Nelze uložit",
        description: "Ponechte alespoň jeden řádek s platnými hodinami.",
      });
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/daily-work-reports/admin-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          companyId,
          employeeId,
          date,
          action: "save",
          segmentJobSplits: payloadSplits,
          note,
          description,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; hoursSum?: number };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data.error || "Uložení se nezdařilo.",
        });
        return;
      }
      toast({
        title: "Uloženo",
        description: `Výkaz byl aktualizován (${data.hoursSum ?? totalHours} h).`,
      });
    } catch {
      toast({ variant: "destructive", title: "Chyba", description: "Síťová chyba." });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteRow = () => {
    if (!deleteRowKey) return;
    setRows((prev) => prev.filter((x) => x.key !== deleteRowKey));
    setDeleteRowKey(null);
  };

  const deleteWholeReport = async () => {
    if (!user || !companyId) return;
    setDeletingWhole(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/daily-work-reports/admin-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          companyId,
          employeeId,
          date,
          action: "deleteReport",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data.error || "Smazání se nezdařilo.",
        });
        return;
      }
      toast({ title: "Smazáno", description: "Denní výkaz byl odstraněn." });
      setDeleteWholeOpen(false);
      onOpenChange(false);
    } catch {
      toast({ variant: "destructive", title: "Chyba", description: "Síťová chyba." });
    } finally {
      setDeletingWhole(false);
    }
  };

  const employeeName =
    typeof report?.employeeName === "string" ? report.employeeName : employeeId;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full max-w-full flex-col border-slate-200 bg-white text-neutral-950 sm:max-w-2xl"
        >
          <SheetHeader className="space-y-1 border-b border-slate-200 pb-4 text-left">
            <SheetTitle className="text-neutral-950">Detail výkazu práce</SheetTitle>
            <SheetDescription className="text-neutral-700">
              {employeeName} · {date}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
            {reportLoading || !report ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-neutral-950 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Stav:</span>
                    {statusBadge(String(report.status ?? ""))}
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <div>
                      <span className="text-neutral-600">Celkem hodin (řádky):</span>{" "}
                      <span className="font-semibold tabular-nums">{totalHours} h</span>
                    </div>
                    <div>
                      <span className="text-neutral-600">Z terminálu (řádky):</span>{" "}
                      <span className="font-semibold tabular-nums">{sumTerminalHours} h</span>
                    </div>
                    <div>
                      <span className="text-neutral-600">Ruční řádky:</span>{" "}
                      <span className="font-semibold tabular-nums">{sumManualHours} h</span>
                    </div>
                    <div>
                      <span className="text-neutral-600">Tarifní úseky (dokumenty dne):</span>{" "}
                      <span className="font-semibold tabular-nums">{tariffHoursDay} h</span>
                    </div>
                  </div>
                  {typeof report.estimatedLaborFromSegmentsCzk === "number" &&
                  report.estimatedLaborFromSegmentsCzk > 0 ? (
                    <div>
                      <span className="text-neutral-600">Odhad práce (segmenty, uloženo):</span>{" "}
                      <span className="font-medium tabular-nums">
                        {formatKc(report.estimatedLaborFromSegmentsCzk)}
                      </span>
                    </div>
                  ) : null}
                  {typeof report.payableAmountCzk === "number" && report.payableAmountCzk > 0 ? (
                    <div>
                      <span className="text-neutral-600">K výplatě (schváleno):</span>{" "}
                      <span className="font-medium tabular-nums">
                        {formatKc(report.payableAmountCzk)}
                      </span>
                    </div>
                  ) : null}
                  <div className="grid gap-1 text-xs text-neutral-600 sm:grid-cols-2">
                    <div>Odesláno: {tsLabel(report.submittedAt)}</div>
                    <div>Upraveno: {tsLabel(report.updatedAt)}</div>
                  </div>
                  {typeof report.adminNote === "string" && report.adminNote.trim() ? (
                    <div className="rounded border border-slate-100 bg-slate-50 p-2 text-xs text-neutral-800">
                      <span className="font-medium">Poznámka administrátora (schválení):</span>{" "}
                      {report.adminNote}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dwr-note" className="text-neutral-950">
                    Poznámka k výkazu
                  </Label>
                  <Textarea
                    id="dwr-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-h-[72px] border-slate-300 bg-white text-neutral-950"
                    placeholder="Interní / sdílená poznámka k výkazu…"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dwr-desc" className="text-neutral-950">
                    Souhrnný popis práce (text výkazu)
                  </Label>
                  <Textarea
                    id="dwr-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[100px] border-slate-300 bg-white text-neutral-950"
                    placeholder="Popis činností…"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-neutral-950">Řádky výkazu</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-300 text-neutral-950"
                      onClick={() =>
                        setRows((prev) => [
                          ...prev,
                          {
                            key: `new-${Date.now()}`,
                            segmentType: DAILY_REPORT_ROW_SOURCE_MANUAL,
                            segmentId: "",
                            jobId: NO_JOB_SEGMENT_JOB_ID,
                            jobName: "",
                            hoursStr: "",
                            lineNote: "",
                          },
                        ])
                      }
                    >
                      Přidat ruční řádek
                    </Button>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200 hover:bg-transparent">
                          <TableHead className="text-neutral-950">Typ</TableHead>
                          <TableHead className="text-neutral-950">Hodiny</TableHead>
                          <TableHead className="text-neutral-950">Zakázka</TableHead>
                          <TableHead className="min-w-[140px] text-neutral-950">Popis řádku</TableHead>
                          <TableHead className="text-right text-neutral-950">Odhad</TableHead>
                          <TableHead className="w-[100px] text-right text-neutral-950">Akce</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-neutral-600">
                              Žádné řádky — přidejte ruční řádek nebo upravte uložený výkaz.
                            </TableCell>
                          </TableRow>
                        ) : (
                          rows.map((r) => (
                            <TableRow key={r.key} className="border-slate-200">
                              <TableCell className="align-top text-neutral-900">
                                <div className="flex flex-col gap-1">
                                  <Badge variant="outline" className="w-fit border-slate-400 text-neutral-900">
                                    {r.segmentType === DAILY_REPORT_ROW_SOURCE_TERMINAL
                                      ? "Terminál"
                                      : "Ruční"}
                                  </Badge>
                                  {r.segmentType === DAILY_REPORT_ROW_SOURCE_TERMINAL && r.segmentId ? (
                                    <span className="max-w-[120px] break-all text-[10px] text-neutral-500">
                                      Úsek: {r.segmentId.slice(0, 10)}…
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-neutral-500">Interní / bez úseku</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <Input
                                  className="h-9 w-20 border-slate-300 bg-white text-neutral-950 tabular-nums"
                                  value={r.hoursStr}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x) =>
                                        x.key === r.key ? { ...x, hoursStr: e.target.value } : x
                                      )
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="flex max-w-[220px] flex-col gap-1">
                                  <select
                                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-neutral-950"
                                    value={isNoJobSegmentJobId(r.jobId) ? "" : r.jobId}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      const jid = v ? v : NO_JOB_SEGMENT_JOB_ID;
                                      const jn = v ? jobsById.get(v)?.name ?? "" : "";
                                      setRows((prev) =>
                                        prev.map((x) =>
                                          x.key === r.key ? { ...x, jobId: jid, jobName: jn } : x
                                        )
                                      );
                                    }}
                                  >
                                    <option value="">Bez zakázky (interní)</option>
                                    {jobsOptions.map((j) => (
                                      <option key={j.id} value={j.id}>
                                        {j.name}
                                      </option>
                                    ))}
                                  </select>
                                  {r.segmentType === DAILY_REPORT_ROW_SOURCE_TERMINAL ? (
                                    <span className="text-[10px] text-neutral-500">
                                      Řádek z úseku terminálu — změna zakázky přepíše přiřazení v tomto výkazu.
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <Textarea
                                  className="min-h-[64px] border-slate-300 bg-white text-sm text-neutral-950"
                                  value={r.lineNote}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x) =>
                                        x.key === r.key ? { ...x, lineNote: e.target.value } : x
                                      )
                                    )
                                  }
                                  placeholder="Co dělal…"
                                />
                              </TableCell>
                              <TableCell className="align-top text-right text-sm tabular-nums text-neutral-900">
                                {rowAmountHint(r) > 0 ? formatKc(rowAmountHint(r)) : "—"}
                              </TableCell>
                              <TableCell className="align-top text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    title="Smazat řádek"
                                    onClick={() => setDeleteRowKey(r.key)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="mt-auto flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    className="gap-2 bg-neutral-900 text-white hover:bg-neutral-800"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Uložit změny
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-300 text-neutral-950"
                    disabled={saving || deletingWhole}
                    onClick={() => setDeleteWholeOpen(true)}
                  >
                    Smazat celý výkaz
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteRowKey} onOpenChange={(v) => !v && setDeleteRowKey(null)}>
        <AlertDialogContent className="border-slate-200 bg-white text-neutral-950">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat řádek?</AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-700">
              Řádek bude odebrán ze seznamu. Pro trvalé uložení klikněte na „Uložit změny“.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300">Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteRow}
            >
              Odebrat z výkazu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteWholeOpen} onOpenChange={setDeleteWholeOpen}>
        <AlertDialogContent className="border-slate-200 bg-white text-neutral-950">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat celý výkaz?</AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-700">
              Dokument výkazu a navázané náklady zakázky z výkazu budou odstraněny. Tuto akci nelze vrátit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300" disabled={deletingWhole}>
              Zrušit
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingWhole}
              onClick={() => void deleteWholeReport()}
            >
              {deletingWhole ? <Loader2 className="h-4 w-4 animate-spin" /> : "Trvale smazat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
