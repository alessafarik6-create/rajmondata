"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";

function TerminalInner() {
  const sp = useSearchParams();
  const company = sp.get("company");
  return (
    <AttendanceTerminal
      standalone
      companyIdOverride={company ?? undefined}
    />
  );
}

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh grid place-items-center bg-background text-foreground text-lg">
          Načítání terminálu…
        </div>
      }
    >
      <TerminalInner />
    </Suspense>
  );
}
