"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  getInquiryTypeChipClass,
  getInquiryTypeLabel,
  normalizeInquiryType,
} from "@/lib/inquiry-type-badge";

export type InquiryTypeBadgeProps = {
  type: string | null | undefined;
  className?: string;
  variant?: "preview" | "detail";
};

/**
 * Čip typu poptávky — `<span>` + hash paleta (ne Badge).
 */
export function InquiryTypeBadge({
  type,
  className,
  variant = "preview",
}: InquiryTypeBadgeProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("inquiry type", type);
    console.log("normalized type", normalizeInquiryType(type));
    console.log("chip class", getInquiryTypeChipClass(type));
  }, [type]);

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
