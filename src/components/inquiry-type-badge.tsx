"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getInquiryTypeBadgeClass } from "@/lib/inquiry-type-badge";

export type InquiryTypeBadgeProps = {
  /** Text typu ze zdroje (beze změny). */
  type: string | null | undefined;
  className?: string;
  /**
   * `preview` — řádek seznamu / náhled (větší, kontrastnější).
   * `detail` — rozbalený blok s popiskem „Typ poptávky“.
   */
  variant?: "preview" | "detail";
};

/**
 * Barevný štítek typu poptávky — stejné mapování jako `getInquiryTypeBadgeClass`
 * (modulové domy / pergoly / obecné / fallback).
 */
export function InquiryTypeBadge({
  type,
  className,
  variant = "preview",
}: InquiryTypeBadgeProps) {
  const t = String(type ?? "").trim();
  if (!t) return null;
  return (
    <Badge
      variant="default"
      className={cn(
        "shrink-0 truncate",
        variant === "preview"
          ? "max-w-[min(100%,18rem)] px-2.5 py-1.5 text-xs font-semibold leading-snug sm:text-sm"
          : "w-fit max-w-[min(100%,28rem)] px-2 py-1 text-xs font-normal leading-normal",
        getInquiryTypeBadgeClass(t),
        className
      )}
    >
      {t}
    </Badge>
  );
}
