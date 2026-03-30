"use client";

import { cn } from "@/lib/utils";
import {
  getInquiryTypeBadgeClass,
  getInquiryTypeBadgeLabel,
} from "@/lib/inquiry-type-badge";

export type InquiryTypeBadgeProps = {
  type: string | null | undefined;
  className?: string;
  /**
   * `preview` — řádek seznamu / náhled.
   * `detail` — rozbalený blok s popiskem „Typ poptávky“.
   */
  variant?: "preview" | "detail";
};

/**
 * Štítek typu poptávky — `<span>` s pevnými barvami (ne `Badge`, aby nevznikaly kolize s CVA).
 */
export function InquiryTypeBadge({
  type,
  className,
  variant = "preview",
}: InquiryTypeBadgeProps) {
  const label = getInquiryTypeBadgeLabel(type);
  return (
    <span
      role="status"
      className={cn(
        getInquiryTypeBadgeClass(type),
        variant === "preview"
          ? "max-w-[min(100%,18rem)] truncate px-2.5 py-1.5 text-xs sm:text-sm"
          : "w-fit max-w-[min(100%,28rem)] truncate px-2 py-1 text-xs font-normal leading-normal",
        className
      )}
    >
      {label}
    </span>
  );
}
