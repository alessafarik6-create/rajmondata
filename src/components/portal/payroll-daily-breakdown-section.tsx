"use client";

import React, { useMemo, useState } from "react";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { EmployeeDailyDetailRow, EmployeeLite } from "@/lib/attendance-overview-compute";
import { formatHoursMinutes, formatKc } from "@/lib/attendance-overview-compute";
import { buildAttendanceDayTimeline } from "@/lib/attendance-day-timeline";
import {
  PAYROLL_ADJUSTMENT_REASONS,
  type EmployeeDayManualAttendanceAudit,
  type EmployeeDayPayoutAdjustmentAudit,
} from "@/lib/employee-day-payout";
import { computeManualAttendanceWorkedMinutes } from "@/lib/manual-attendance-payout";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  directionAndFieldsFromAdjustmentMinutes,
  parsePayrollAdjustmentMinutes,
  type PayrollAdjustmentDirection,
} from "@/lib/payroll-day-adjustment";

export type SaveDayAdjustmentPayload = {
  mode: "adjustment";
  dateIso: string;
  adjustmentMinutes: number;
  reasonCode: string;
  note: string;
  previousMinutes: number;
};

export type SaveDayManualAttendancePayload = {
  mode: "manual_attendance";
  dateIso: string;
  checkInHm: string;
  checkOutHm: string;
  breakMinutes: number;
  workedMinutes: number;
  reasonCode: string;
  note: string;
};

export type SaveDayPayrollEditPayload =
  | SaveDayAdjustmentPayload
  | SaveDayManualAttendancePayload;

export type SaveDayAdjustmentResult =
  | { ok: true }
  | { ok: false; message: string };

type Props = {
  rows: EmployeeDailyDetailRow[];
  attendanceRaw: AttendanceRow[];
  employee: EmployeeLite;
  canWrite: boolean;
  saving?: boolean;
  onSavePayrollEdit: (
    payload: SaveDayPayrollEditPayload
  ) => Promise<SaveDayAdjustmentResult>;
  adjustmentAuditByDate?: Map<string, EmployeeDayPayoutAdjustmentAudit[]>;
  manualAttendanceAuditByDate?: Map<string, EmployeeDayManualAttendanceAudit[]>;
};

function dayPayDisplayKc(row: EmployeeDailyDetailRow): number {
  if (row.orientacniKc > 0) return row.orientacniKc;
  return row.schvalenoKc;
}

function hasTerminalWorkForDay(row: EmployeeDailyDetailRow): boolean {
  if (row.manualAttendance) return Boolean(row.terminalOdpracovanoH && row.terminalOdpracovanoH > 0);
  return (
    (row.terminalOdpracovanoH != null && row.terminalOdpracovanoH > 0) ||
    (row.prichod !== "—" && row.odchod !== "—") ||
    row.hasIncompleteAttendance
  );
}

type EditMode = "manual_attendance" | "adjustment";

function formatAdjHours(minutes: number): string {
  if (!minutes) return "0 h";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

function formatHoursCompact(decimalHours: number | null): string {
  if (decimalHours == null || !Number.isFinite(decimalHours) || decimalHours <= 0) {
    return "—";
  }
  const totalMin = Math.round(decimalHours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

function compactDayLabel(row: EmployeeDailyDetailRow): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.dateIso);
  if (m) return `${Number(m[3])}. ${Number(m[2])}.`;
  return row.dayTitle.split(" ").slice(-3).join(" ") || row.dayTitle;
}

function rowTariffShort(
  row: EmployeeDailyDetailRow,
  employee: EmployeeLite
): string {
  const seg = row.tariffSegments.find((t) => t.rateKcPerH != null);
  if (seg?.rateKcPerH != null) return `${seg.rateKcPerH} Kč/h`;
  if (row.tariffSegments.length > 1) return "Více tarifů";
  if (employee.hourlyRate > 0) return `${employee.hourlyRate} Kč/h`;
  return "—";
}

function compactStatusLine(row: EmployeeDailyDetailRow): string {
  const manual =
    row.payrollSource === "manual" ? "Ručně · " : "";
  const appr =
    row.schvalenoStatus === "approved"
      ? "Schv."
      : row.schvalenoStatus === "pending"
        ? "Čeká"
        : "—";
  if (row.paidStatus === "paid") return `${manual}${appr} · Vypl.`;
  if (row.paidStatus === "unpaid") return `${manual}${appr} · Nezapl.`;
  return `${manual}${appr}`;
}

const thClass =
  "h-9 px-2 text-left align-middle text-xs font-medium text-slate-800";
const tdClass = "px-2 py-1.5 align-middle text-xs text-slate-900";

function DayDetailPanel(props: {
  row: EmployeeDailyDetailRow;
  timeline: ReturnType<typeof buildAttendanceDayTimeline>;
  employee: EmployeeLite;
}) {
  const { row, timeline, employee } = props;
  const rate = employee.hourlyRate;
  const sourceLabel =
    row.payrollSource === "manual"
      ? "Ručně zadáno administrátorem"
      : row.payrollSource === "terminal"
        ? "Terminál"
        : "—";

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-900">
      <p className="text-slate-700">
        <span className="font-medium">Zdroj pro výplatu:</span> {sourceLabel}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <p>
          <span className="text-slate-600">Příchod:</span>{" "}
          <strong>{row.prichod}</strong>
        </p>
        <p>
          <span className="text-slate-600">Odchod:</span>{" "}
          <strong>{row.odchod}</strong>
        </p>
        <p>
          <span className="text-slate-600">Celková přítomnost:</span>{" "}
          {formatHoursMinutes(row.totalSpanH)}
        </p>
        <p>
          <span className="text-slate-600">Oběd / přestávka:</span>{" "}
          {formatHoursMinutes(row.pauseH)}
        </p>
        <p>
          <span className="text-slate-600">Terminál (raw):</span>{" "}
          {formatHoursMinutes(row.terminalOdpracovanoH)}
        </p>
        <p>
          <span className="text-slate-600">Základ pro mzdu:</span>{" "}
          {formatHoursMinutes(row.baseWorkedH)}
        </p>
        {row.adjustmentMinutes ? (
          <p>
            <span className="text-slate-600">Korekce:</span>{" "}
            {formatAdjHours(row.adjustmentMinutes)}
          </p>
        ) : null}
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
  onSavePayrollEdit,
  adjustmentAuditByDate,
  manualAttendanceAuditByDate,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editRow, setEditRow] = useState<EmployeeDailyDetailRow | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("manual_attendance");
  const [adjHours, setAdjHours] = useState("0");
  const [adjMinutes, setAdjMinutes] = useState("0");
  const [adjDirection, setAdjDirection] =
    useState<PayrollAdjustmentDirection>("add");
  const [manualCheckIn, setManualCheckIn] = useState("07:00");
  const [manualCheckOut, setManualCheckOut] = useState("15:30");
  const [manualBreakMin, setManualBreakMin] = useState("30");
  const [reasonCode, setReasonCode] = useState<string>("attendance_fix");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
    const fields = directionAndFieldsFromAdjustmentMinutes(totalMin);
    setAdjDirection(fields.direction);
    setAdjHours(fields.hours);
    setAdjMinutes(fields.minutes);
    const ma = row.manualAttendance;
    setManualCheckIn(
      ma?.checkInHm ?? (row.prichod !== "—" ? row.prichod : "07:00")
    );
    setManualCheckOut(
      ma?.checkOutHm ?? (row.odchod !== "—" ? row.odchod : "15:30")
    );
    setManualBreakMin(String(ma?.breakMinutes ?? 30));
    setEditMode(
      hasTerminalWorkForDay(row) && !ma ? "adjustment" : "manual_attendance"
    );
    setReasonCode(
      row.manualAttendance?.reasonCode ??
        row.adjustmentReasonCode ??
        "off_terminal_work"
    );
    setNote(row.manualAttendance?.note ?? row.adjustmentNote ?? "");
    setFormError(null);
    setEditRow(row);
  };

  const submitEdit = async () => {
    if (!editRow) return;
    setFormError(null);
    if (!reasonCode.trim()) {
      setFormError("Vyberte důvod.");
      return;
    }
    if (!note.trim()) {
      setFormError("Vyplňte poznámku.");
      return;
    }
    if (editMode === "manual_attendance") {
      const br = Number(manualBreakMin) || 0;
      const computed = computeManualAttendanceWorkedMinutes(
        manualCheckIn,
        manualCheckOut,
        br
      );
      if (!computed.ok) {
        setFormError(computed.error);
        return;
      }
      const result = await onSavePayrollEdit({
        mode: "manual_attendance",
        dateIso: editRow.dateIso,
        checkInHm: manualCheckIn.trim(),
        checkOutHm: manualCheckOut.trim(),
        breakMinutes: br,
        workedMinutes: computed.workedMinutes,
        reasonCode,
        note: note.trim(),
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setEditRow(null);
      return;
    }
    const parsed = parsePayrollAdjustmentMinutes(adjHours, adjMinutes, adjDirection);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    const result = await onSavePayrollEdit({
      mode: "adjustment",
      dateIso: editRow.dateIso,
      adjustmentMinutes: parsed.minutes,
      reasonCode,
      note: note.trim(),
      previousMinutes: editRow.adjustmentMinutes ?? 0,
    });
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
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
      <div className="hidden w-full min-w-0 max-w-full lg:block">
        <table className="w-full min-w-0 table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[2rem]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col style={{ width: "auto" }} />
          </colgroup>
          <thead className="[&_tr]:border-b">
            <tr>
              <th className={thClass} aria-label="Rozbalit" />
              <th className={thClass}>Den</th>
              <th className={thClass}>Odprac.</th>
              <th className={thClass}>Tarif</th>
              <th className={thClass}>Výplata</th>
              <th className={thClass}>Stav</th>
              <th className={cn(thClass, "min-w-[9.5rem] text-right")}>Akce</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {rows.map((row) => {
              const open = expanded[row.key];
              const tl = timelines.get(row.dateIso);
              const isPaid = row.paidStatus === "paid";
              return (
                <React.Fragment key={row.key}>
                  <tr className="border-b transition-colors hover:bg-muted/40">
                    <td className={tdClass}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
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
                    </td>
                    <td className={cn(tdClass, "leading-tight")} title={row.dayTitle}>
                      {compactDayLabel(row)}
                    </td>
                    <td className={cn(tdClass, "font-medium")}>
                      <span
                        title={
                          row.adjustmentMinutes
                            ? `Terminál: ${formatHoursCompact(row.terminalOdpracovanoH)} · Korekce: ${formatAdjHours(row.adjustmentMinutes)}`
                            : undefined
                        }
                      >
                        {formatHoursCompact(row.payrollWorkedH)}
                        {row.adjustmentMinutes ? (
                          <span className="ml-0.5 text-orange-600" aria-label="Ruční korekce">
                            *
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={cn(tdClass, "leading-tight")}>{rowTariffShort(row, employee)}</td>
                    <td className={cn(tdClass, "font-medium tabular-nums")}>
                      {formatKc(dayPayDisplayKc(row))}
                    </td>
                    <td className={cn(tdClass, "leading-tight text-slate-700")}>
                      {compactStatusLine(row)}
                    </td>
                    <td className={cn(tdClass, "text-right")}>
                      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
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
                            disabled={isPaid || saving}
                            title={isPaid ? "Den je vyplacen — korekci nelze měnit" : undefined}
                            className="h-7 shrink-0 whitespace-nowrap bg-orange-600 px-2 text-xs text-white hover:bg-orange-700"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Upravit
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b">
                      <td colSpan={7} className="bg-white px-2 py-2">
                        {row.adjustmentMinutes ? (
                          <p className="mb-2 text-xs text-orange-800">
                            Ruční korekce: {formatAdjHours(row.adjustmentMinutes)} (terminál:{" "}
                            {formatHoursCompact(row.terminalOdpracovanoH)})
                          </p>
                        ) : null}
                        <DayDetailPanel row={row} timeline={tl ?? null} employee={employee} />
                        {manualAttendanceAuditByDate?.get(row.dateIso)?.length ? (
                          <div className="mt-3 border-t pt-2 text-xs text-slate-600">
                            <p className="font-medium text-slate-800">Historie ruční docházky</p>
                            {manualAttendanceAuditByDate
                              .get(row.dateIso)!
                              .slice(-3)
                              .map((a, i) => (
                                <p key={i}>
                                  {a.at}: {a.byName ?? a.byUid} — {a.checkInHm}–{a.checkOutHm},
                                  přestávka {a.breakMinutes} min ({a.reasonCode}) {a.note}
                                </p>
                              ))}
                          </div>
                        ) : null}
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
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
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
                Započteno: {formatHoursMinutes(row.payrollWorkedH)} · Výplata{" "}
                {formatKc(dayPayDisplayKc(row))}
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
                  <Button
                    type="button"
                    size="sm"
                    className="bg-orange-600 text-white hover:bg-orange-700"
                    onClick={() => openEdit(row)}
                  >
                    Upravit
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
            <DialogTitle>Upravit docházku / výplatu dne</DialogTitle>
          </DialogHeader>
          {editRow?.schvalenoStatus === "approved" ? (
            <Alert>
              <AlertDescription>
                Tento den je již schválen. Po úpravě bude nutné ho znovu schválit.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 py-2">
            <p className="text-sm text-slate-700">
              Terminál (raw):{" "}
              <strong>{formatHoursMinutes(editRow?.terminalOdpracovanoH ?? null)}</strong>
              {editRow ? (
                <>
                  {" "}
                  · Základ mzdy:{" "}
                  <strong>{formatHoursMinutes(editRow.baseWorkedH)}</strong>
                </>
              ) : null}
            </p>
            <div className="space-y-2">
              <Label>Typ úpravy</Label>
              <RadioGroup
                value={editMode}
                onValueChange={(v) => {
                  setEditMode(v as EditMode);
                  setFormError(null);
                }}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="manual_attendance" id="mode-manual" />
                  <Label htmlFor="mode-manual" className="cursor-pointer font-normal">
                    Ručně zadat docházku
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="adjustment" id="mode-adj" />
                  <Label htmlFor="mode-adj" className="cursor-pointer font-normal">
                    Přidat / odebrat korekci k základu
                  </Label>
                </div>
              </RadioGroup>
            </div>
            {editMode === "manual_attendance" ? (
              <div className="grid gap-2 rounded-md border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Příchod</Label>
                    <Input
                      value={manualCheckIn}
                      onChange={(e) => setManualCheckIn(e.target.value)}
                      placeholder="06:33"
                    />
                  </div>
                  <div>
                    <Label>Odchod</Label>
                    <Input
                      value={manualCheckOut}
                      onChange={(e) => setManualCheckOut(e.target.value)}
                      placeholder="15:30"
                    />
                  </div>
                </div>
                <div>
                  <Label>Přestávka / oběd (minuty)</Label>
                  <Input
                    value={manualBreakMin}
                    onChange={(e) => setManualBreakMin(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-2 rounded-md border border-slate-200 p-3">
                <div className="space-y-2">
                  <Label>Typ korekce</Label>
                  <RadioGroup
                    value={adjDirection}
                    onValueChange={(v) =>
                      setAdjDirection(v as PayrollAdjustmentDirection)
                    }
                    className="flex flex-wrap gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="add" id="adj-add" />
                      <Label htmlFor="adj-add" className="cursor-pointer font-normal">
                        Přidat čas
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="subtract" id="adj-sub" />
                      <Label htmlFor="adj-sub" className="cursor-pointer font-normal">
                        Odebrat čas
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Hodiny</Label>
                    <Input
                      value={adjHours}
                      onChange={(e) => {
                        setAdjHours(e.target.value);
                        setFormError(null);
                      }}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>Minuty (0–59)</Label>
                    <Input
                      value={adjMinutes}
                      onChange={(e) => {
                        setAdjMinutes(e.target.value);
                        setFormError(null);
                      }}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            )}
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
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
              disabled={saving}
              onClick={() => void submitEdit()}
            >
              {saving ? "Ukládám…" : "Uložit korekci"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
