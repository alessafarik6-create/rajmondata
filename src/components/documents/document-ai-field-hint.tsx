"use client";

import React from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function DocumentAiFieldHint(props: {
  aiFilled?: boolean;
  lowConfidence?: boolean;
  className?: string;
}) {
  if (!props.aiFilled && !props.lowConfidence) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium leading-none",
        props.lowConfidence ? "text-amber-700" : "text-violet-700",
        props.className
      )}
      title={props.lowConfidence ? "Zkontrolujte údaj" : "Načteno pomocí AI"}
    >
      {props.lowConfidence ? (
        <>
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          Zkontrolovat
        </>
      ) : (
        <>
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
          AI
        </>
      )}
    </span>
  );
}

export function DocumentAiFieldLabel(props: {
  htmlFor?: string;
  children: React.ReactNode;
  aiFilled?: boolean;
  lowConfidence?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      <label htmlFor={props.htmlFor} className="text-sm font-medium leading-none">
        {props.children}
      </label>
      <DocumentAiFieldHint
        aiFilled={props.aiFilled}
        lowConfidence={props.lowConfidence}
      />
    </span>
  );
}
