"use client";

import React, { useState } from "react";
import { FileDown, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  exportJobMediaWithNotesPdf,
  printJobMediaWithNotes,
  type JobMediaNotesExportInput,
} from "@/lib/job-media-export-with-notes";

const iconBtnClassName =
  "min-h-[38px] shrink-0 gap-1 rounded-md border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent [&_svg]:!size-[16px]";

function ExportIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={iconBtnClassName}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
          <span className="hidden md:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function JobMediaExportNotesButtons(props: {
  buildInput: () => JobMediaNotesExportInput | null;
  disabled?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"export" | "print" | null>(null);

  const run = async (mode: "export" | "print") => {
    const input = props.buildInput();
    if (!input) {
      toast({
        variant: "destructive",
        title: "Export není k dispozici",
        description: "Soubor nemá URL ani poznámky k exportu.",
      });
      return;
    }
    setBusy(mode);
    try {
      if (mode === "export") {
        await exportJobMediaWithNotesPdf(input);
        toast({ title: "PDF bylo vygenerováno" });
      } else {
        await printJobMediaWithNotes(input);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: mode === "export" ? "Export PDF selhal" : "Tisk selhal",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(null);
    }
  };

  const isBusy = busy !== null;
  const spin = <Loader2 className="size-[18px] animate-spin" aria-hidden />;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", props.className)}>
      <ExportIconButton
        label="Exportovat s poznámkami"
        disabled={props.disabled || isBusy}
        onClick={() => void run("export")}
      >
        {busy === "export" ? spin : <FileDown className="size-[18px]" aria-hidden />}
      </ExportIconButton>
      <ExportIconButton
        label="Tisk s poznámkami"
        disabled={props.disabled || isBusy}
        onClick={() => void run("print")}
      >
        {busy === "print" ? spin : <Printer className="size-[18px]" aria-hidden />}
      </ExportIconButton>
    </span>
  );
}
