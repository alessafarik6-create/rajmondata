"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  formatMessageDate,
  messageAuthorNameFromRecord,
  messageAuthorRoleLabelFromRecord,
} from "@/lib/format-message-date";

type Props = {
  message: Record<string, unknown>;
  /** Volitelné přepsání jména (např. „Zákazník“ u chatu). */
  authorNameOverride?: string;
  className?: string;
};

/** Hlavička zprávy: autor + role, pod tím datum a čas. */
export function JobMessageHeader({ message, authorNameOverride, className }: Props) {
  const author = authorNameOverride ?? messageAuthorNameFromRecord(message);
  const role = messageAuthorRoleLabelFromRecord(message);
  const sentAt = formatMessageDate(message);

  return (
    <div className={className ?? "mb-1.5 space-y-0.5"}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span className="font-semibold text-gray-900">{author}</span>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {role}
        </Badge>
      </div>
      <p className="text-xs tabular-nums text-gray-500">{sentAt}</p>
    </div>
  );
}
