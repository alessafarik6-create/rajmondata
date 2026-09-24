"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileDown, Loader2, MoreHorizontal, Printer } from "lucide-react";

export type JobDetailExportKind =
  | "summary"
  | "job_sheet"
  | "financial"
  | "budget"
  | "invoices"
  | "received_docs"
  | "issued_docs"
  | "deposits"
  | "payments"
  | "material"
  | "labor"
  | "meetings"
  | "full";

export function JobDetailExportPrintMenu(props: {
  mobile?: boolean;
  loading?: boolean;
  disabled?: boolean;
  canSummary: boolean;
  canFinancial: boolean;
  canBudget: boolean;
  canInvoices: boolean;
  canDocuments: boolean;
  canLabor: boolean;
  canMeetings: boolean;
  onExport: (kind: JobDetailExportKind) => void;
  onPrintContract?: () => void;
}) {
  const {
    mobile,
    loading,
    disabled,
    canSummary,
    canFinancial,
    canBudget,
    canInvoices,
    canDocuments,
    canLabor,
    canMeetings,
    onExport,
    onPrintContract,
  } = props;

  const trigger = mobile ? (
    <Button type="button" variant="outline" size="icon" className="h-10 w-10" disabled={disabled || loading}>
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
    </Button>
  ) : (
    <Button type="button" variant="outline" className={JD_ACTION} disabled={disabled || loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      Tisk / PDF
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Export zakázky</DropdownMenuLabel>
        {canSummary ? (
          <>
            <DropdownMenuItem onClick={() => onExport("summary")}>Souhrn zakázky</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("job_sheet")}>Zakázkový list</DropdownMenuItem>
          </>
        ) : null}
        {canFinancial ? (
          <>
            <DropdownMenuItem onClick={() => onExport("financial")}>Finanční přehled</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("deposits")}>Přehled záloh</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("payments")}>Přehled plateb</DropdownMenuItem>
          </>
        ) : null}
        {canBudget ? (
          <DropdownMenuItem onClick={() => onExport("budget")}>Rozpočet (PDF)</DropdownMenuItem>
        ) : null}
        {canInvoices ? (
          <DropdownMenuItem onClick={() => onExport("invoices")}>Přehled fakturace</DropdownMenuItem>
        ) : null}
        {canDocuments ? (
          <>
            <DropdownMenuItem onClick={() => onExport("received_docs")}>Přijaté doklady</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("issued_docs")}>Vydané doklady</DropdownMenuItem>
          </>
        ) : null}
        {canLabor ? (
          <DropdownMenuItem onClick={() => onExport("labor")}>Přehled práce</DropdownMenuItem>
        ) : null}
        {canMeetings ? (
          <DropdownMenuItem onClick={() => onExport("meetings")}>Přehled schůzek</DropdownMenuItem>
        ) : null}
        {canSummary && canFinancial ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("full")}>Kompletní PDF zakázky</DropdownMenuItem>
          </>
        ) : null}
        {onPrintContract ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onPrintContract}>
              <Printer className="mr-2 h-4 w-4" /> Tisk smlouvy (SOD)
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const JD_ACTION = "gap-2 min-h-10";
