"use client";

import { useEffect } from "react";
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
 * Čip typu poptávky — `<span>`. Nepoužívej zde `cn()`/twMerge nad barevnými třídami čipu,
 * aby se neodstraňovaly `bg-*` / `text-black`.
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

  const variantLayout =
    variant === "preview"
      ? "max-w-[min(100%,18rem)] text-xs sm:text-sm"
      : "w-fit max-w-[min(100%,28rem)] text-xs font-normal";

  const merged = [
    getInquiryTypeChipClass(type),
    variantLayout,
    className?.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span role="status" className={merged}>
      {getInquiryTypeLabel(type)}
    </span>
  );
}
