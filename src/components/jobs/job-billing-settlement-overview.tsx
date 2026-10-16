"use client";

import React from "react";
import type { JobSettlementComputation } from "@/lib/jobs/job-financial-settlement";
import { JOB_VAT_REGIME } from "@/lib/jobs/job-financial-settlement";

function money(g: number, suffix = " Kč") {
  return `${g.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

type Props = {
  computation: JobSettlementComputation;
};

export function JobBillingSettlementOverview({ computation }: Props) {
  const cv = computation.currentValue;
  const regimeLabel =
    computation.vatRegime === JOB_VAT_REGIME.REVERSE_CHARGE
      ? "Přenesená daňová povinnost"
      : computation.vatRegime === JOB_VAT_REGIME.EXEMPT
        ? "Osvobozeno od DPH"
        : "Běžné DPH";

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs text-neutral-800">
      <div className="font-semibold text-neutral-950 text-sm">Přehled vyúčtování zakázky</div>
      <p className="text-[11px] text-neutral-600">Daňový režim: {regimeLabel}</p>

      <section>
        <h4 className="font-semibold text-neutral-900 mb-1">Celková hodnota prací</h4>
        <ul className="space-y-0.5">
          <li>
            Původní rozpočet:{" "}
            <strong>
              {money(cv.contractBase.net)} bez DPH · DPH {money(cv.contractBase.vat, "")} ·{" "}
              {money(cv.contractBase.gross)} s DPH
            </strong>
          </li>
          {cv.extraWorkApproved.gross > 0.009 ? (
            <li>
              Schválené vícepráce:{" "}
              <strong>
                {money(cv.extraWorkApproved.net)} bez DPH ·{" "}
                {money(cv.extraWorkApproved.gross)} s DPH
              </strong>
            </li>
          ) : null}
          {cv.deductions.gross > 0.009 ? (
            <li>
              Odpočty / méněpráce:{" "}
              <strong>−{money(cv.deductions.gross)} s DPH</strong>
            </li>
          ) : null}
          <li className="pt-1 border-t border-neutral-200">
            Aktuální cena zakázky:{" "}
            <strong>{money(cv.current.gross)} s DPH</strong> ({money(cv.current.net)} bez DPH)
          </li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold text-neutral-900 mb-1">Přijaté zálohy (započteno)</h4>
        {computation.advanceLines.length === 0 ? (
          <p>Žádná uhrazená záloha.</p>
        ) : (
          <ul className="space-y-0.5">
            {computation.advanceLines.map((a) => (
              <li key={a.id}>
                {a.label}: <strong>{money(a.paidGross)} s DPH</strong>
                {a.paidVat > 0 ? ` (DPH ${money(a.paidVat, "")})` : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1">
          Celkem započteno: <strong>{money(computation.totalAdvancePaid)} s DPH</strong>
        </p>
      </section>

      <section>
        <h4 className="font-semibold text-neutral-900 mb-1">Konečné vyúčtování</h4>
        {computation.alreadyInvoicedGross > 0.009 ? (
          <p>
            Již vyfakturováno z rozpočtu:{" "}
            <strong>{money(computation.alreadyInvoicedGross)} s DPH</strong>
          </p>
        ) : null}
        <p>
          Doplatek k úhradě:{" "}
          <strong className="text-base text-neutral-950">
            {money(computation.amountToPay)} s DPH
          </strong>
        </p>
        <p className="text-[11px] text-neutral-600">
          ({money(computation.amountToPayNet)} bez DPH
          {computation.amountToPayVat > 0
            ? ` · DPH ${money(computation.amountToPayVat, "")}`
            : ""}
          )
        </p>
      </section>

      {computation.validationWarnings.length > 0 ? (
        <ul className="list-disc pl-4 text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
          {computation.validationWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      {computation.validationErrors.length > 0 ? (
        <ul className="list-disc pl-4 text-red-900 bg-red-50 border border-red-200 rounded p-2">
          {computation.validationErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
