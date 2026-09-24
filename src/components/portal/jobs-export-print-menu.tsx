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
import type { JobsListExportPreset } from "@/lib/jobs/jobs-list-export-utils";

export function JobsExportPrintMenu(props: {
  disabled?: boolean;
  loading?: boolean;
  mobile?: boolean;
  onExportPdf: (preset: JobsListExportPreset) => void;
  onExportCsv: (preset: JobsListExportPreset) => void;
  onPrint: (preset: JobsListExportPreset) => void;
  onExportContractedPdf?: () => void;
  onExportContractedCsv?: () => void;
  showContracted?: boolean;
  contractedLoading?: boolean;
}) {
  const {
    disabled,
    loading,
    mobile,
    onExportPdf,
    onExportCsv,
    onPrint,
    onExportContractedPdf,
    onExportContractedCsv,
    showContracted,
    contractedLoading,
  } = props;

  const trigger = mobile ? (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10 shrink-0"
      disabled={disabled || loading}
      aria-label="Export a tisk"
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
    </Button>
  ) : (
    <Button
      type="button"
      variant="outlineLight"
      className="gap-2 min-h-[44px]"
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      Export / Tisk
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Přehled zakázek (filtry)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExportPdf("current")}>
          <FileDown className="mr-2 h-4 w-4" /> Přehled zakázek PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportCsv("current")}>
          <FileDown className="mr-2 h-4 w-4" /> Přehled zakázek CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPrint("current")}>
          <Printer className="mr-2 h-4 w-4" /> Tisk aktuálního přehledu
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Doplňkový výběr (× filtry)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExportPdf("overdue")}>Zakázky po termínu</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportPdf("active")}>Aktivní zakázky</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportPdf("completed")}>Dokončené zakázky</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportCsv("by_customer")}>Zakázky podle zákazníka (CSV)</DropdownMenuItem>
        {showContracted ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Zesmluvněné</DropdownMenuLabel>
            <DropdownMenuItem disabled={contractedLoading} onClick={() => onExportContractedPdf?.()}>
              PDF zesmluvněných
            </DropdownMenuItem>
            <DropdownMenuItem disabled={contractedLoading} onClick={() => onExportContractedCsv?.()}>
              CSV zesmluvněných
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
