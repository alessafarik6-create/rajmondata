"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/firebase";
import { cn } from "@/lib/utils";

export function PortalPreviewBanner(props: {
  displayName: string;
  subjectEmployeeId: string;
  className?: string;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const endPreview = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/employees/portal-preview/end", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        returnEmployeeId?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Ukončení náhledu se nezdařilo.");
      }
      const id = data.returnEmployeeId || props.subjectEmployeeId;
      router.push(`/portal/employees/${id}?tab=roles`);
      router.refresh();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Ukončení náhledu se nezdařilo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "sticky top-0 z-[60] border-b border-amber-600/60 bg-amber-500 px-3 py-2 text-amber-950 shadow-md",
        "safe-area-inset-top",
        props.className
      )}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2 sm:items-center">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase tracking-wide">
              Režim náhledu — prohlížíte portál jako {props.displayName}
            </p>
            <p className="text-xs font-medium opacity-90">Pouze pro čtení</p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0 border border-amber-900/20 bg-amber-950 text-amber-50 hover:bg-amber-900"
          disabled={busy}
          onClick={() => void endPreview()}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
          Ukončit náhled
        </Button>
      </div>
    </div>
  );
}
