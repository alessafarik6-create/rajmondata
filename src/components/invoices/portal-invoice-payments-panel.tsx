"use client";

import React, { useMemo } from "react";
import { collection, orderBy, query } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { getPortalInvoicePaymentState } from "@/lib/invoice-payment-state";
import {
  invoicePaymentMethodLabel,
  type InvoicePaymentMethod,
} from "@/lib/portal-invoice-payment-eligibility";
import { Loader2 } from "lucide-react";

export function PortalInvoicePaymentsPanel(props: {
  companyId: string;
  invoiceId: string;
  invoice: Record<string, unknown>;
}) {
  const { companyId, invoiceId, invoice } = props;
  const firestore = useFirestore();

  const paymentsQuery = useMemoFirebase(
    () =>
      firestore && companyId && invoiceId
        ? query(
            collection(
              firestore,
              "companies",
              companyId,
              "invoices",
              invoiceId,
              "payments"
            ),
            orderBy("createdAt", "desc")
          )
        : null,
    [firestore, companyId, invoiceId]
  );
  const { data: paymentsRaw, isLoading } = useCollection(paymentsQuery);

  const todayIso = new Date().toISOString().split("T")[0] ?? "2099-01-01";
  const state = useMemo(
    () => getPortalInvoicePaymentState(invoice, todayIso),
    [invoice, todayIso]
  );

  const payments = useMemo(() => {
    return (Array.isArray(paymentsRaw) ? paymentsRaw : []) as Array<
      Record<string, unknown> & { id: string }
    >;
  }, [paymentsRaw]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám úhrady…
      </div>
    );
  }

  if (payments.length === 0 && state.paidAmount <= 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
      <h2 className="text-sm font-semibold text-neutral-900">Úhrady</h2>
      <p className="text-xs text-neutral-600 tabular-nums">
        Uhrazeno celkem: {Math.round(state.paidAmount).toLocaleString("cs-CZ")} Kč
        {state.remainingAmount > 0 ? (
          <>
            {" "}
            · Zbývá: {Math.round(state.remainingAmount).toLocaleString("cs-CZ")} Kč
          </>
        ) : (
          " · Faktura je uhrazena"
        )}
      </p>
      {payments.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {payments.map((p) => {
            const method = String(p.method ?? "bank") as InvoicePaymentMethod;
            const amt = Number(p.amount ?? 0);
            const at = String(p.paidAt ?? "").trim();
            return (
              <li
                key={p.id}
                className="rounded border border-neutral-200 px-2 py-1.5 flex flex-wrap justify-between gap-2"
              >
                <span className="font-medium tabular-nums">
                  {Math.round(amt).toLocaleString("cs-CZ")} Kč
                </span>
                <span className="text-neutral-600">
                  {at
                    ? new Date(at + "T12:00:00").toLocaleDateString("cs-CZ")
                    : "—"}{" "}
                  · {invoicePaymentMethodLabel(method)}
                </span>
                {p.note ? (
                  <span className="w-full text-xs text-neutral-600">{String(p.note)}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
