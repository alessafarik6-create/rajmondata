"use client";

import { cn } from "@/lib/utils";
import {
  getInquiryTypeChipClass,
  getInquiryTypeLabel,
} from "@/lib/inquiry-type-badge";

export type InquiryTypeBadgeProps = {
  type: string | null | undefined;
  className?: string;
  variant?: "preview" | "detail";
};

/**
 * Čip typu poptávky — vždy `<span>`, ne komponenta Badge (žádné CVA / přepisy barev).
 */
export function InquiryTypeBadge({
  type,
  className,
  variant = "preview",
}: InquiryTypeBadgeProps) {
  return (
    <span
      role="status"
      className={cn(
        getInquiryTypeChipClass(type),
        variant === "preview"
          ? "max-w-[min(100%,18rem)] text-xs sm:text-sm"
          : "w-fit max-w-[min(100%,28rem)] text-xs font-normal",
        className
      )}
    >
      {getInquiryTypeLabel(type)}
    </span>
  );
}
