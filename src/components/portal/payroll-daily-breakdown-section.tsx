"use client";

import React, { useMemo, useState } from "react";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { EmployeeDailyDetailRow, EmployeeLite } from "@/lib/attendance-overview-compute";
import { formatHoursMinutes, formatKc } from "@/lib/attendance-overview-compute";
import { buildAttendanceDayTimeline } from "@/lib/attendance-day-timeline";
import { getPaymentBadgeLabel } from "@/lib/payroll-entry-display";
import {
  PAYROLL_ADJUSTMENT_REASONS,
  type EmployeeDayPayoutAdjustmentAudit,
} from "@/lib/employee-day-payout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveDayAdjustmentPayload = {
  dateIso: string;
  adjustmentMinutes: number;
  reasonCode: string;
  note: string;
  previousMinutes: number;
};

type Props = {
  rows: EmployeeDailyDetailRow[];
  attendanceRaw: AttendanceRow[];
  employee: EmployeeLite;
  canWrite: boolean;
  saving?: boolean;
  onSaveAdjustment: (payload: SaveDayAdjustmentPayload) => Promise<void>;
  adjustmentAuditByDate?: Map<string, EmployeeDayPayoutAdjustmentAudit[]>;
};

function formatAdjHours(minutes: number): string {
  if (!minutes) return "0 h";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

function DayDetailPanel(props: {
  row: EmployeeDailyDetailRow;
  timeline: ReturnType<typeof buildAttendanceDayTimeline>;
  employee: EmployeeLite;
}) {
  const { row, timeline, employee } = props;
  const rate = employee.hourlyRate;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-900">
      <div className="grid gap-2 sm:grid-cols-2">
        <p>
          <span className="text-slate-600">Příchod:</span>{" "}
          <strong>{timeline?.checkInHm ?? row.prichod}</strong>
        </p>
        <p>
          <span className="text-slate-600">Odchod:</span>{" "}
          <strong>{timeline?.checkOutHm ?? row.odchod}</strong>
        </p>
        <p>
          <span className="text-slate-600">Celková přítomnost:</span>{" "}
          {formatHoursMinutes(timeline?.totalSpanH ?? row.totalSpanH)}
        </p>
        <p>
          <span className="text-slate-600">Oběd / přestávka:</span>{" "}
          {formatHoursMinutes(timeline?.breakH ?? row.pauseH)}
        </p>
        <p>
          <span className="text-slate-600">Terminál (započteno):</span>{" "}
          {formatHoursMinutes(row.terminalOdpracovanoH)}
        </p>
        <p>
          <span className="text-slate-600">Výsledně pro výplatu:</span>{" "}
          <strong>{formatHoursMinutes(row.payrollWorkedH)}</strong>
        </p>
      </div>

      {timeline?.workBlocks.length ? (
        <div>
          <p className="mb-1 font-medium">Bloky docházky</p>
          <ul className="space-y-1 text-slate-800">
            {timeline.workBlocks.map((b) => (
              <li key={b.index}>
                Blok {b.index}: {b.startHm} – {b.endHm} ({formatHoursMinutes(b.durationH)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {timeline?.breaks.length ? (
        <div>
          <p className="mb-1 font-medium">Přestávky</p>
          <ul className="space-y-1 text-slate-800">
            {timeline.breaks.map((b, i) => (
              <li key={i}>
                {b.source === "explicit" ? (
                  <>
                    {b.startHm} – {b.endHm} ({formatHoursMinutes(b.durationH)})
                  </>
                ) : (
                  <>Odvozený odpočet pauzy: {formatHoursMinutes(b.durationH)}</>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.tariffSegments.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">Tarify</p>
          <ul className="space-y-1">
            {row.tariffSegments.map((t) => (
              <li key={t.id}>
                {t.label}: {t.startHm}–{t.endLabel}, {formatHoursMinutes(t.durationH)}
                {t.rateKcPerH != null ? `, ${t.rateKcPerH} Kč/h` : ""} → {formatKc(t.earningsKc)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.jobSegments.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">Zakázky</p>
          <ul className="space-y-1">
            {row.jobSegments.map((j) => (
              <li key={j.id}>
                {j.label}: {j.startHm}–{j.endLabel}, {formatHoursMinutes(j.durationH)} →{" "}
                {formatKc(j.earningsKc)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.hoursOutsideTariffAndJob > 0 && rate > 0 ? (
        <p className="text-slate-800">
          Základní sazba zaměstnance ({rate} Kč/h):{" "}
          {formatHoursMinutes(row.hoursOutsideTariffAndJob)} →{" "}
          {formatKc(row.orientacniKcStandard)}
        </p>
      ) : rate > 0 ? (
        <p className="text-slate-600">Základní sazba: {rate} Kč/h (historie sazeb v systému zatím není — používá se aktuální sazba zaměstnance).</p>
      ) : null}

      <p className="font-medium">
        Výpočet dne (orientačně): {formatKc(row.orientacniKc)} · Schváleno:{" "}
        {formatKc(row.schvalenoKc)}
      </p>
    </div>
  );
}

export function PayrollDailyBreakdownSection({
  rows,
  attendanceRaw,
  employee,
  canWrite,
  saving,
  onSaveAdjustment,
  adjustmentAuditByDate,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editRow, setEditRow] = useState<EmployeeDailyDetailRow | null>(null);
  const [adjHours, setAdjHours] = useState("0");
  const [adjMinutes, setAdjMinutes] = useState("0");
  const [reasonCode, setReasonCode] = useState<string>("attendance_fix");
  const [note, setNote] = useState("");

  const timelines = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildAttendanceDayTimeline>>();
    for (const row of rows) {
      m.set(
        row.dateIso,
        buildAttendanceDayTimeline(attendanceRaw, row.dateIso, {
          employeeId: employee.id,
          authUid: employee.authUserId ?? undefined,
        })
      );
    }
    return m;
  }, [rows, attendanceRaw, employee]);

  const openEdit = (row: EmployeeDailyDetailRow) => {
    const totalMin = row.adjustmentMinutes ?? 0;
    const sign = totalMin < 0 ? "-" : "";
    const abs = Math.abs(totalMin);
    setAdjHours(String(sign + Math.floor(abs / 60)));
    setAdjMinutes(String(abs % 60));
    setReasonCode(row.adjustmentReasonCode ?? "attendance_fix");
    setNote(row.adjustmentNote ?? "");
    setEditRow(row);
  };

  const submitEdit = async () => {
    if (!editRow) return;
    const h = Number(String(adjHours).replace(",", ".")) || 0;
    const m = Number(adjMinutes) || 0;
    let total = Math.round(h * 60 + m);
    if (String(adjHours).trim().startsWith("-")) total = -Math.abs(total);
    else if (h < 0) total = -Math.abs(total);
    if (!reasonCode) return;
    if (!note.trim()) return;
    await onSaveAdjustment({
      dateIso: editRow.dateIso,
      adjustmentMinutes: total,
      reasonCode,
      note: note.trim(),
      previousMinutes: editRow.adjustmentMinutes ?? 0,
    });
    setEditRow(null);
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Za toto období nejsou žádné denní řádky (docházka / segmenty / výkazy).
      </p>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Den</TableHead>
              <TableHead>Příchod–odchod</TableHead>
              <TableHead>Přestávka</TableHead>
              <TableHead>Terminál</TableHead>
              <TableHead>Korekce</TableHead>
              <TableHead>Výsledek</TableHead>
              <TableHead>Schv. Kč</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const open = expanded[row.key];
              const tl = timelines.get(row.dateIso);
              const isPaid = row.paidStatus === "paid";
              return (
                <React.Fragment key={row.key}>
                  <TableRow>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [row.key]: !e[row.key] }))
                        }
                      >
                        {open ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.dayTitle}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {row.prichod !== "—" && row.odchod !== "—"
                        ? `${row.prichod}–${row.odchod}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatHoursMinutes(row.pauseH)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.terminalOdpracovanoH != null
                        ? `${row.terminalOdpracovanoH} h`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.adjustmentMinutes ? (
                        <span title={`Původně terminál: ${row.terminalOdpracovanoH ?? "—"} h`}>
                          <Badge variant="secondary" className="font-normal">
                            Upraveno {formatAdjHours(row.adjustmentMinutes)}
                          </Badge>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {row.payrollWorkedH != null ? `${row.payrollWorkedH} h` : "—"}
                    </TableCell>
                    <TableCell>{formatKc(row.schvalenoKc)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="font-normal">
                          {row.schvalenoStatus === "approved"
                            ? "Schváleno"
                            : row.schvalenoStatus === "pending"
                              ? "Čeká"
                              : "—"}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {getPaymentBadgeLabel(row.paidStatus)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpanded((e) => ({ ...e, [row.key]: !e[row.key] }))
                          }
                        >
                          Detail
                        </Button>
                        {canWrite ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isPaid || saving}
                            title={isPaid ? "Den je vyplacen — korekci nelze měnit" : undefined}
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Upravit
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-white">
                        <DayDetailPanel row={row} timeline={tl ?? null} employee={employee} />
                        {adjustmentAuditByDate?.get(row.dateIso)?.length ? (
                          <div className="mt-3 border-t pt-2 text-xs text-slate-600">
                            <p className="font-medium text-slate-800">Historie korekcí</p>
                            {adjustmentAuditByDate.get(row.dateIso)!.slice(-3).map((a, i) => (
                              <p key={i}>
                                {a.at}: {a.byName ?? a.byUid} — {a.previousMinutes} →{" "}
                                {a.newMinutes} min ({a.reasonCode}) {a.note}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const open = expanded[row.key];
          const tl = timelines.get(row.dateIso);
          return (
            <div key={row.key} className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{row.dayTitle}</p>
              <p>
                {row.prichod} → {row.odchod}
              </p>
              <p>Oběd: {formatHoursMinutes(row.pauseH)}</p>
              <p>
                Započteno: {formatHoursMinutes(row.payrollWorkedH)} · Schv.{" "}
                {formatKc(row.schvalenoKc)}
              </p>
              {row.adjustmentMinutes ? (
                <Badge variant="secondary" className="mt-1">
                  Upraveno {formatAdjHours(row.adjustmentMinutes)}
                </Badge>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded((e) => ({ ...e, [row.key]: !e[row.key] }))}
                >
                  Detail
                </Button>
                {canWrite && row.paidStatus !== "paid" ? (
                  <Button type="button" size="sm" onClick={() => openEdit(row)}>
                    Upravit den
                  </Button>
                ) : null}
              </div>
              {open ? (
                <div className="mt-3">
                  <DayDetailPanel row={row} timeline={tl ?? null} employee={employee} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upravit započtený čas</DialogTitle>
          </DialogHeader>
          {editRow?.schvalenoStatus === "approved" ? (
            <Alert>
              <AlertDescription>
                Tento den je již schválen. Úpravou se přepočítá schválená částka.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 py-2">
            <p className="text-sm text-slate-700">
              Terminál:{" "}
              <strong>{formatHoursMinutes(editRow?.terminalOdpracovanoH ?? null)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Hodiny (+/−)</Label>
                <Input value={adjHours} onChange={(e) => setAdjHours(e.target.value)} />
              </div>
              <div>
                <Label>Minuty</Label>
                <Input
                  value={adjMinutes}
                  onChange={(e) => setAdjMinutes(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div>
              <Label>Důvod</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYROLL_ADJUSTMENT_REASONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Poznámka (povinná)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditRow(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={saving || !note.trim()}
              onClick={() => void submitEdit()}
            >
              Uložit korekci
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
