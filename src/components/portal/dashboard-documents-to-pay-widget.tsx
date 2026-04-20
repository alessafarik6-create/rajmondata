"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useFirestore, useMemoFirebase, useCollection, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  compareDocumentsForPaymentQueue,
  documentDisplayTitleForPayment,
  documentGrossForPayment,
  getDocumentPaymentUrgency,
  isDocumentEligibleForPaymentBox,
  PAYMENT_DUE_SOON_DAYS,
  type CompanyDocumentPaymentRow,
  urgencyLabel,
} from "@/lib/company-document-payment";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";

type Props = {
  companyId: string;
  todayIso: string;
};

export function DashboardDocumentsToPayWidget({ companyId, todayIso }: Props) {
  const firestore = useFirestore();
  const { user } = useUser();

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "documents");
  }, [firestore, companyId]);

  const { data: rawDocs, isLoading } = useCollection(qRef);

  const rows = useMemo(() => {
    const list = (rawDocs ?? []) as CompanyDocumentPaymentRow[];
    const filtered = list.filter(isDocumentEligibleForPaymentBox);
    filtered.sort((a, b) => compareDocumentsForPaymentQueue(a, b, todayIso));
    return filtered;
  }, [rawDocs, todayIso]);

  const stats = useMemo(() => {
    const list = (rawDocs ?? []) as CompanyDocumentPaymentRow[];
    let totalKc = 0;
    let overdue = 0;
    let toPay = 0;
    for (const d of list) {
      if (!isDocumentEligibleForPaymentBox(d)) continue;
      toPay += 1;
      totalKc += documentGrossForPayment(d);
      if (getDocumentPaymentUrgency(d, todayIso) === "overdue") overdue += 1;
    }
    return { totalKc, overdue, toPay };
  }, [rawDocs, todayIso]);

  const markPaid = async (id: string) => {
    if (!firestore || !user?.uid || !String(id ?? "").trim()) return;
    const todayIso = new Date().toISOString().split("T")[0];
    await updateDoc(doc(firestore, "companies", companyId, "documents", id), {
      paymentStatus: "paid",
      paidAmount: null,
      paidAt: todayIso,
      paymentMethod: null,
      paymentNote: null,
      paid: true,
      paidBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  if (isLoading) {
    return (
      <Card className="mx-auto w-full max-w-xl border border-gray-300 bg-white text-gray-900 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Banknote className="h-5 w-5 shrink-0" aria-hidden />
            Nutno uhradit
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-gray-600" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0 && stats.toPay === 0) {
    return null;
  }

  return (
    <Card className="mx-auto w-full max-w-xl border border-gray-300 bg-white text-gray-900 shadow-sm">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Banknote className="h-5 w-5 shrink-0" aria-hidden />
          Nutno uhradit
        </CardTitle>
        <CardDescription className="text-sm text-gray-700">
          Doklady označené k úhradě ({PAYMENT_DUE_SOON_DAYS} dní = blížící se splatnost). Celkem{" "}
          <span className="font-semibold tabular-nums">{stats.toPay}</span> ks ·{" "}
          <span className="font-semibold tabular-nums">
            {Math.round(stats.totalKc).toLocaleString("cs-CZ")} Kč
          </span>
          {stats.overdue > 0 ? (
            <span className="text-red-700">
              {" "}
              · Po splatnosti: <strong>{stats.overdue}</strong>
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-[min(55vh,420px)] overflow-y-auto rounded-md border border-gray-200">
          <ul className="divide-y divide-gray-200">
            {rows.map((row, index) => {
              const u = getDocumentPaymentUrgency(row, todayIso);
              const gross = documentGrossForPayment(row);
              const subtitle =
                row.entityName?.trim() ||
                row.poznamka?.trim() ||
                row.note?.trim() ||
                row.description?.trim() ||
                "";
              const due = String(row.dueDate ?? "").trim();
              return (
                <li
                  key={row.id ?? `pay-${index}`}
                  className={cn(
                    "px-3 py-2.5 text-sm",
                    u === "overdue" && "bg-red-50",
                    u === "due_soon" && "bg-amber-50",
                    u === "incomplete_no_due" && "bg-yellow-50"
                  )}
                >
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug text-gray-900 line-clamp-2">
                        {documentDisplayTitleForPayment(row)}
                      </p>
                      {subtitle ? (
                        <p className="text-xs text-gray-600 line-clamp-1">{subtitle}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="tabular-nums font-semibold text-gray-900">
                          {Math.round(gross).toLocaleString("cs-CZ")} Kč
                        </span>
                        {due ? (
                          <span className="text-xs text-gray-700">
                            Splatnost:{" "}
                            {new Date(due + "T12:00:00").toLocaleDateString("cs-CZ")}
                          </span>
                        ) : (
                          <Badge variant="outline" className="border-amber-600 text-amber-900">
                            Chybí splatnost
                          </Badge>
                        )}
                        <Badge
                          className={cn(
                            "text-[10px]",
                            u === "overdue" && "bg-red-700 text-white hover:bg-red-700",
                            u === "due_soon" && "bg-amber-600 text-white hover:bg-amber-600",
                            u === "incomplete_no_due" &&
                              "border border-amber-700 bg-yellow-100 text-amber-950",
                            u === "ok" && "bg-gray-200 text-gray-900 hover:bg-gray-200"
                          )}
                        >
                          {urgencyLabel(u)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1 sm:flex-col sm:items-stretch">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-gray-400 text-xs text-gray-900"
                        asChild
                      >
                        <Link href={`/portal/documents`}>
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          Otevřít
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-emerald-700 text-xs text-white hover:bg-emerald-800"
                        onClick={() => void markPaid(row.id ?? "")}
                      >
                        Zaplaceno
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Úplný seznam a úpravy v sekci{" "}
          <Link href="/portal/documents" className="font-medium underline">
            Doklady
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
