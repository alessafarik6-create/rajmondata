"use client";

import React from "react";
import type {
  DailyDetailPeriodTotals,
  EmployeeDailyDetailRow,
  OverviewTableRow,
} from "@/lib/attendance-overview-compute";
import { formatHoursMinutes, formatKc } from "@/lib/attendance-overview-compute";
import { cn } from "@/lib/utils";

function formatHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  return `${h} h`;
}

function formatRateKcPerH(kc: number | null): string {
  if (kc == null || !Number.isFinite(kc)) return "—";
  return `${Math.round(kc)} Kč/h`;
}

function formatHoursPeriodTotal(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 h";
  return formatHoursMinutes(h);
}

function schvalenoDayLine(day: EmployeeDailyDetailRow): string {
  if (day.schvalenoKc > 0) return formatKc(day.schvalenoKc);
  if (day.schvalenoStatus === "pending") return "čeká na schválení";
  if (day.schvalenoStatus === "none" && (day.odpracovanoH ?? 0) > 0) return "neodsouhlaseno";
  return "—";
}

export type AttendanceExportDocumentProps = {
  className?: string;
  companyName: string;
  companyId: string | undefined;
  rangeLabel: string;
  periodTitle: string;
  customRangeLine: string | null;
  employeeLabel: string;
  generatedAtLabel: string;
  variant: "detail" | "summary";
  dailyDetailRows: EmployeeDailyDetailRow[] | null;
  detailTotals: DailyDetailPeriodTotals | null;
  summaryTotalsAll: DailyDetailPeriodTotals | null;
  tableRows: OverviewTableRow[];
  aggregateTotals: { hours: number; approvedKc: number; pendingKc: number };
  hasEmptyData: boolean;
};

export function AttendanceExportDocument({
  className,
  companyName,
  companyId,
  rangeLabel,
  periodTitle,
  customRangeLine,
  employeeLabel,
  generatedAtLabel,
  variant,
  dailyDetailRows,
  detailTotals,
  summaryTotalsAll,
  tableRows,
  aggregateTotals,
  hasEmptyData,
}: AttendanceExportDocumentProps) {
  const org = companyName && companyName !== "Organization" ? companyName : companyId || "—";

  return (
    <div
      className={cn(
        "attendance-print-root box-border bg-white text-[11pt] leading-snug text-black antialiased",
        className
      )}
    >
      <header className="border-b-2 border-black pb-3">
        <h1 className="text-[16pt] font-bold leading-tight text-black">
          Přehled docházky a výdělků
        </h1>
        <p className="mt-2 text-[11pt] font-semibold text-black">{org}</p>
        <dl className="mt-3 grid gap-1 text-[10pt] text-black">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Období:</dt>
            <dd>{rangeLabel}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Režim:</dt>
            <dd>{periodTitle}</dd>
          </div>
          {customRangeLine && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">Období (od–do):</dt>
              <dd>{customRangeLine}</dd>
            </div>
          )}
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Vygenerováno:</dt>
            <dd>{generatedAtLabel}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Zaměstnanec / výběr:</dt>
            <dd>{employeeLabel}</dd>
          </div>
        </dl>
      </header>

      {hasEmptyData ? (
        <p className="mt-6 text-[11pt] italic text-black">Žádná data pro zvolené filtry.</p>
      ) : variant === "detail" && dailyDetailRows && detailTotals ? (
        <>
          <section className="mt-4 border border-black p-3 print:break-inside-avoid">
            <h2 className="text-[12pt] font-bold text-black">Souhrn přehledu (období)</h2>
            <ul className="mt-2 space-y-1 text-[10pt] text-black">
              <li>
                Dny s prací: <strong>{detailTotals.daysWorked}</strong> · Odpracováno:{" "}
                <strong>{formatHours(detailTotals.hours)}</strong> · Schválený výdělek:{" "}
                <strong>{formatKc(detailTotals.approvedKc)}</strong> · Orientační výdělek:{" "}
                <strong>{formatKc(detailTotals.orientacniKc)}</strong>
              </li>
              <li>
                Čas na tarifech: <strong>{formatHoursPeriodTotal(detailTotals.totalTariffHours)}</strong> (
                {formatKc(detailTotals.totalTariffKc)}) · Čas mimo tarif (docházka − tarify):{" "}
                <strong>{formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffOnly)}</strong>
              </li>
              <li>
                Čas na zakázkách: <strong>{formatHoursPeriodTotal(detailTotals.totalJobHours)}</strong> (
                {formatKc(detailTotals.totalJobKc)}) · Mimo tarif i zakázku (standard):{" "}
                <strong>{formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffJob)}</strong> (
                {formatKc(detailTotals.totalStandardKc)})
              </li>
            </ul>
          </section>

          <section className="mt-6 space-y-4">
            <h2 className="text-[12pt] font-bold text-black">Denní rozpis</h2>
            {dailyDetailRows.map((day) => (
              <article
                key={day.key}
                className="break-inside-avoid rounded-sm border border-black p-3 print:break-inside-avoid"
              >
                <h3 className="border-b border-black pb-1 text-[11pt] font-bold capitalize text-black">
                  {day.dayTitle}
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10pt] sm:grid-cols-4">
                  <div>
                    <p className="font-semibold text-black">Příchod</p>
                    <p className="tabular-nums">{day.prichod}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-black">Odchod</p>
                    <p className="tabular-nums">{day.odchod}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-black">Odpracováno</p>
                    <p className="tabular-nums">{formatHours(day.odpracovanoH)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-black">Záznamů docházky</p>
                    <p className="tabular-nums">{day.bloku}</p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10pt]">
                  <div>
                    <p className="font-semibold text-black">Čas na tarifech (součet)</p>
                    <p className="tabular-nums">{formatHoursMinutes(day.tariffHoursTotal)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-black">Čas mimo tarif (docházka − tarify)</p>
                    <p className="tabular-nums">{formatHoursMinutes(day.hoursOutsideTariffOnly)}</p>
                  </div>
                </div>

                {day.tariffSegments.length > 0 && (
                  <div className="mt-3 border-t border-black pt-2">
                    <p className="text-[10pt] font-bold uppercase tracking-wide text-black">Tarifní úseky</p>
                    <table className="mt-2 w-full border-collapse border border-black text-[9pt]">
                      <thead>
                        <tr className="border-b-2 border-black bg-white">
                          <th className="border border-black px-1 py-1 text-left font-bold text-black">
                            Tarif
                          </th>
                          <th className="border border-black px-1 py-1 text-left font-bold text-black">
                            Od–do
                          </th>
                          <th className="border border-black px-1 py-1 text-right font-bold text-black">
                            Délka
                          </th>
                          <th className="border border-black px-1 py-1 text-right font-bold text-black">
                            Sazba
                          </th>
                          <th className="border border-black px-1 py-1 text-right font-bold text-black">
                            Výdělek
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.tariffSegments.map((t) => (
                          <tr key={t.id} className="break-inside-avoid">
                            <td className="border border-black px-1 py-1 text-black">{t.label}</td>
                            <td className="border border-black px-1 py-1 tabular-nums text-black">
                              {t.startHm}–{t.endLabel}
                            </td>
                            <td className="border border-black px-1 py-1 text-right tabular-nums text-black">
                              {formatHoursMinutes(t.durationH)}
                            </td>
                            <td className="border border-black px-1 py-1 text-right text-black">
                              {formatRateKcPerH(t.rateKcPerH)}
                            </td>
                            <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums text-black">
                              {formatKc(t.earningsKc)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {day.jobSegments.length > 0 && (
                  <div className="mt-3 border-t border-black pt-2">
                    <p className="text-[10pt] font-bold uppercase tracking-wide text-black">
                      Zakázky (sazba zakázky)
                    </p>
                    <ul className="mt-1 space-y-1 text-[9pt] text-black">
                      {day.jobSegments.map((j) => (
                        <li key={j.id} className="break-inside-avoid border-l-2 border-black pl-2">
                          <span className="font-semibold">{j.label}</span> — {j.startHm}–{j.endLabel},{" "}
                          {formatHoursMinutes(j.durationH)}, {formatRateKcPerH(j.rateKcPerH)},{" "}
                          <strong>{formatKc(j.earningsKc)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 border-t border-black pt-2 text-[10pt] text-black">
                  <p className="font-bold">Orientační výdělek (rozpad)</p>
                  <ul className="mt-1 list-none space-y-0.5">
                    <li className="flex justify-between gap-4">
                      <span>Mimo tarif i zakázku – standard ({formatHours(day.hoursOutsideTariffAndJob)})</span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcStandard)}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>Z tarifů</span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcTariff)}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>Ze zakázek</span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcJob)}</span>
                    </li>
                    <li className="flex justify-between gap-4 border-t border-black pt-1 font-bold">
                      <span>Celkem orientačně</span>
                      <span className="tabular-nums">{formatKc(day.orientacniKc)}</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-2 text-[10pt] font-bold text-black">
                  Schválený výdělek: {schvalenoDayLine(day)}
                </div>
              </article>
            ))}
          </section>

          <footer className="mt-8 break-inside-avoid border-t-2 border-black pt-4">
            <h2 className="text-[12pt] font-bold text-black">Souhrn dokumentu</h2>
            <ul className="mt-2 space-y-1 text-[10pt] text-black">
              <li>
                Celkem odpracováno: <strong>{formatHours(detailTotals.hours)}</strong>
              </li>
              <li>
                Celkem čas na tarifech:{" "}
                <strong>{formatHoursPeriodTotal(detailTotals.totalTariffHours)}</strong>
              </li>
              <li>
                Celkem čas mimo tarif (docházka − tarify):{" "}
                <strong>{formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffOnly)}</strong>
              </li>
              <li>
                Celkový orientační výdělek: <strong>{formatKc(detailTotals.orientacniKc)}</strong>
              </li>
              <li>
                Celkový schválený výdělek: <strong>{formatKc(detailTotals.approvedKc)}</strong>
              </li>
            </ul>
          </footer>
        </>
      ) : (
        <>
          <section className="mt-4 border border-black p-3 print:break-inside-avoid">
            <h2 className="text-[12pt] font-bold text-black">Souhrn (všichni zaměstnanci)</h2>
            {summaryTotalsAll ? (
              <ul className="mt-2 space-y-1 text-[10pt] text-black">
                <li>
                  Odpracováno: <strong>{formatHours(summaryTotalsAll.hours)}</strong> · Schválený výdělek:{" "}
                  <strong>{formatKc(summaryTotalsAll.approvedKc)}</strong> · Orientační výdělek:{" "}
                  <strong>{formatKc(summaryTotalsAll.orientacniKc)}</strong>
                </li>
                <li>
                  Čas na tarifech: <strong>{formatHoursPeriodTotal(summaryTotalsAll.totalTariffHours)}</strong> (
                  {formatKc(summaryTotalsAll.totalTariffKc)}) · Čas mimo tarif (docházka − tarify):{" "}
                  <strong>{formatHoursPeriodTotal(summaryTotalsAll.totalHoursOutsideTariffOnly)}</strong>
                </li>
                <li>
                  Zakázky: <strong>{formatHoursPeriodTotal(summaryTotalsAll.totalJobHours)}</strong> (
                  {formatKc(summaryTotalsAll.totalJobKc)}) · Standard (mimo tarif i zakázku):{" "}
                  {formatHoursPeriodTotal(summaryTotalsAll.totalHoursOutsideTariffJob)} (
                  {formatKc(summaryTotalsAll.totalStandardKc)})
                </li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-[10pt] text-black">
                <li>
                  Odpracováno: <strong>{formatHours(aggregateTotals.hours)}</strong> · Schválený výdělek:{" "}
                  <strong>{formatKc(aggregateTotals.approvedKc)}</strong> · Orientační výdělek:{" "}
                  <strong>{formatKc(aggregateTotals.pendingKc)}</strong>
                </li>
              </ul>
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-[12pt] font-bold text-black">Přehled zaměstnanců</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse border border-black text-[9pt]">
                <thead>
                  <tr className="border-b-2 border-black bg-white">
                    <th className="border border-black px-1 py-1 text-left font-bold text-black">
                      Období / datum
                    </th>
                    <th className="border border-black px-1 py-1 text-left font-bold text-black">
                      Zaměstnanec
                    </th>
                    <th className="border border-black px-1 py-1 text-left font-bold text-black">
                      Příchod
                    </th>
                    <th className="border border-black px-1 py-1 text-left font-bold text-black">Odchod</th>
                    <th className="border border-black px-1 py-1 text-right font-bold text-black">
                      Odpracováno
                    </th>
                    <th className="border border-black px-1 py-1 text-right font-bold text-black">
                      Záznamů
                    </th>
                    <th className="border border-black px-1 py-1 text-right font-bold text-black">
                      Schváleno
                    </th>
                    <th className="border border-black px-1 py-1 text-right font-bold text-black">
                      Orientačně
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr key={row.key} className="break-inside-avoid">
                      <td className="border border-black px-1 py-1 text-black">{row.datumLabel}</td>
                      <td className="border border-black px-1 py-1 font-medium text-black">
                        {row.employeeName}
                      </td>
                      <td className="border border-black px-1 py-1 tabular-nums text-black">{row.prichod}</td>
                      <td className="border border-black px-1 py-1 tabular-nums text-black">{row.odchod}</td>
                      <td className="border border-black px-1 py-1 text-right tabular-nums text-black">
                        {formatHours(row.odpracovanoH)}
                      </td>
                      <td className="border border-black px-1 py-1 text-right tabular-nums text-black">
                        {row.bloku}
                      </td>
                      <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums text-black">
                        {formatKc(row.schvalenoKc)}
                      </td>
                      <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums text-black">
                        {formatKc(row.orientacniKc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="mt-8 break-inside-avoid border-t-2 border-black pt-4">
            <h2 className="text-[12pt] font-bold text-black">Souhrn dokumentu</h2>
            {summaryTotalsAll ? (
              <ul className="mt-2 space-y-1 text-[10pt] text-black">
                <li>
                  Celkem odpracováno: <strong>{formatHours(summaryTotalsAll.hours)}</strong>
                </li>
                <li>
                  Celkem čas na tarifech:{" "}
                  <strong>{formatHoursPeriodTotal(summaryTotalsAll.totalTariffHours)}</strong>
                </li>
                <li>
                  Celkem čas mimo tarif (docházka − tarify):{" "}
                  <strong>{formatHoursPeriodTotal(summaryTotalsAll.totalHoursOutsideTariffOnly)}</strong>
                </li>
                <li>
                  Celkový orientační výdělek: <strong>{formatKc(summaryTotalsAll.orientacniKc)}</strong>
                </li>
                <li>
                  Celkový schválený výdělek: <strong>{formatKc(summaryTotalsAll.approvedKc)}</strong>
                </li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-[10pt] text-black">
                <li>
                  Celkem odpracováno: <strong>{formatHours(aggregateTotals.hours)}</strong>
                </li>
                <li>
                  Celkový orientační výdělek: <strong>{formatKc(aggregateTotals.pendingKc)}</strong>
                </li>
                <li>
                  Celkový schválený výdělek: <strong>{formatKc(aggregateTotals.approvedKc)}</strong>
                </li>
              </ul>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
