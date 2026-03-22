"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AttendancePortalPage } from "@/components/portal/AttendancePortalPage";

export default function LaborDochazkaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <AttendancePortalPage />
    </Suspense>
  );
}
