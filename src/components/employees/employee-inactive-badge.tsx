"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { isEmployeeActive, type EmployeeActiveFields } from "@/lib/employee-active";
import { cn } from "@/lib/utils";

/** U historických záznamů — označení neaktivního zaměstnance. */
export function EmployeeInactiveBadge(props: {
  employee?: EmployeeActiveFields | null;
  className?: string;
}) {
  if (!props.employee || isEmployeeActive(props.employee)) return null;
  return (
    <Badge variant="secondary" className={cn("text-[10px] font-normal", props.className)}>
      Neaktivní
    </Badge>
  );
}
